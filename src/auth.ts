import { Env, OAuth2Credentials } from "./types";
import { UserConfigManager } from "./user-config-manager";
import {
	CODE_ASSIST_ENDPOINT,
	CODE_ASSIST_API_VERSION,
	OAUTH_CLIENT_ID,
	OAUTH_CLIENT_SECRET,
	OAUTH_REFRESH_URL,
	TOKEN_BUFFER_TIME,
} from "./config";

// Auth-related interfaces
interface TokenRefreshResponse {
	access_token: string;
	expires_in: number;
}

interface CachedTokenData {
	access_token: string;
	expiry_date: number;
	cached_at: number;
}

interface TokenCacheInfo {
	cached: boolean;
	cached_at?: string;
	expires_at?: string;
	time_until_expiry_seconds?: number;
	is_expired?: boolean;
	message?: string;
	error?: string;
}

/**
 * Handles OAuth2 authentication and Google Code Assist API communication.
 * Manages token caching, refresh, and API calls.
 */
export class AuthManager {
	private env: Env;
	private apiKey: string;
	private accessToken: string | null = null;
	private currentCredentialIndex: number = 0;

	constructor(env: Env, apiKey: string) {
		this.env = env;
		this.apiKey = apiKey;
	}

	/**
	 * Initializes authentication using OAuth2 credentials with KV storage caching.
	 */
	public async initializeAuth(): Promise<void> {
		const userConfigManager = new UserConfigManager(this.env, this.apiKey);
		const userConfig = await userConfigManager.getConfig();

		if (!userConfig || !userConfig.gcpServiceAccounts || userConfig.gcpServiceAccounts.length === 0) {
			throw new Error("`GCP_SERVICE_ACCOUNTS` is not configured for this API key.");
		}

		this.currentCredentialIndex = userConfig.currentCredentialIndex;
		const gcpServiceAccountJSON = userConfig.gcpServiceAccounts[this.currentCredentialIndex];

		if (!gcpServiceAccountJSON) {
			throw new Error(`No GCP service account found at index ${this.currentCredentialIndex}.`);
		}

		console.log(`Using credential at index: ${this.currentCredentialIndex}`);

		try {
			const cacheKey = `token:${this.apiKey}:${this.currentCredentialIndex}`;
			let cachedTokenData = null;

			try {
				const cachedToken = await this.env.GEMINI_CLI_KV.get(cacheKey, "json");
				if (cachedToken) {
					cachedTokenData = cachedToken as CachedTokenData;
					console.log(`Found cached token in KV storage for index ${this.currentCredentialIndex}`);
				}
			} catch (kvError) {
				console.log(`No cached token found in KV storage for index ${this.currentCredentialIndex} or KV error:`, kvError);
			}

			if (cachedTokenData) {
				const timeUntilExpiry = cachedTokenData.expiry_date - Date.now();
				if (timeUntilExpiry > TOKEN_BUFFER_TIME) {
					this.accessToken = cachedTokenData.access_token;
					console.log(`Using cached token, valid for ${Math.floor(timeUntilExpiry / 1000)} more seconds`);
					return;
				}
				console.log("Cached token expired or expiring soon");
			}

			const oauth2Creds: OAuth2Credentials = JSON.parse(gcpServiceAccountJSON);

			if (oauth2Creds.expiry_date && oauth2Creds.access_token) {
				const timeUntilExpiry = oauth2Creds.expiry_date - Date.now();
				if (timeUntilExpiry > TOKEN_BUFFER_TIME) {
					this.accessToken = oauth2Creds.access_token;
					console.log(`Original token is valid for ${Math.floor(timeUntilExpiry / 1000)} more seconds`);
					await this.cacheTokenInKV(oauth2Creds.access_token, oauth2Creds.expiry_date);
					return;
				}
			}

			console.log("All tokens expired, refreshing...");
			await this.refreshAndCacheToken(oauth2Creds.refresh_token);
		} catch (e: unknown) {
			const errorMessage = e instanceof Error ? e.message : String(e);
			console.error("Failed to initialize authentication:", e);
			throw new Error("Authentication failed: " + errorMessage);
		}
	}

	/**
	 * Refresh the OAuth token and cache it in KV storage.
	 */
	private async refreshAndCacheToken(refreshToken: string): Promise<void> {
		console.log("Refreshing OAuth token...");

		const refreshResponse = await fetch(OAUTH_REFRESH_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded"
			},
			body: new URLSearchParams({
				client_id: OAUTH_CLIENT_ID,
				client_secret: OAUTH_CLIENT_SECRET,
				refresh_token: refreshToken,
				grant_type: "refresh_token"
			})
		});

		if (!refreshResponse.ok) {
			const errorText = await refreshResponse.text();
			console.error("Token refresh failed:", errorText);
			throw new Error(`Token refresh failed: ${errorText}`);
		}

		const refreshData = (await refreshResponse.json()) as TokenRefreshResponse;
		this.accessToken = refreshData.access_token;
		const expiryTime = Date.now() + refreshData.expires_in * 1000;

		console.log("Token refreshed successfully");
		console.log(`New token expires in ${refreshData.expires_in} seconds`);

		await this.cacheTokenInKV(refreshData.access_token, expiryTime);
	}

	/**
	 * Cache the access token in KV storage.
	 */
	private async cacheTokenInKV(accessToken: string, expiryDate: number): Promise<void> {
		try {
			const tokenData = {
				access_token: accessToken,
				expiry_date: expiryDate,
				cached_at: Date.now()
			};

			const ttlSeconds = Math.floor((expiryDate - Date.now()) / 1000) - 300;
			const cacheKey = `token:${this.apiKey}:${this.currentCredentialIndex}`;

			if (ttlSeconds > 0) {
				await this.env.GEMINI_CLI_KV.put(cacheKey, JSON.stringify(tokenData), {
					expirationTtl: ttlSeconds
				});
				console.log(`Token cached in KV storage for index ${this.currentCredentialIndex} with TTL of ${ttlSeconds} seconds`);
			} else {
				console.log("Token expires too soon, not caching in KV");
			}
		} catch (kvError) {
			console.error("Failed to cache token in KV storage:", kvError);
		}
	}

	/**
	 * Clear cached token from KV storage.
	 */
	public async clearTokenCache(index?: number): Promise<void> {
		const indexToClear = index ?? this.currentCredentialIndex;
		const cacheKey = `token:${this.apiKey}:${indexToClear}`;
		try {
			await this.env.GEMINI_CLI_KV.delete(cacheKey);
			console.log(`Cleared cached token from KV storage for index ${indexToClear}`);
		} catch (kvError) {
			console.log("Error clearing KV cache:", kvError);
		}
	}

	/**
	 * Get cached token info from KV storage.
	 */
	public async getCachedTokenInfo(): Promise<TokenCacheInfo> {
		const cacheKey = `token:${this.apiKey}:${this.currentCredentialIndex}`;
		try {
			const cachedToken = await this.env.GEMINI_CLI_KV.get(cacheKey, "json");
			if (cachedToken) {
				const tokenData = cachedToken as CachedTokenData;
				const timeUntilExpiry = tokenData.expiry_date - Date.now();

				return {
					cached: true,
					cached_at: new Date(tokenData.cached_at).toISOString(),
					expires_at: new Date(tokenData.expiry_date).toISOString(),
					time_until_expiry_seconds: Math.floor(timeUntilExpiry / 1000),
					is_expired: timeUntilExpiry < 0
				};
			}
			return { cached: false, message: "No token found in cache" };
		} catch (e: unknown) {
			const errorMessage = e instanceof Error ? e.message : String(e);
			return { cached: false, error: errorMessage };
		}
	}

	/**
	 * A generic method to call a Code Assist API endpoint.
	 */
	public async callEndpoint(method: string, body: Record<string, unknown>, isRetry: boolean = false): Promise<unknown> {
		await this.initializeAuth();

		const response = await fetch(`${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:${method}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.accessToken}`
			},
			body: JSON.stringify(body)
		});

		if (!response.ok) {
			if (response.status === 401 && !isRetry) {
				console.log("Got 401 error, clearing token cache and retrying...");
				this.accessToken = null;
				await this.clearTokenCache();
				await this.initializeAuth();
				return this.callEndpoint(method, body, true);
			}
			const errorText = await response.text();
			throw new Error(`API call failed with status ${response.status}: ${errorText}`);
		}

		const userConfigManager = new UserConfigManager(this.env, this.apiKey);
		await userConfigManager.incrementRequestCount(this.currentCredentialIndex);

		return response.json();
	}

	/**
	 * Get the current access token.
	 */
	public getAccessToken(): string | null {
		return this.accessToken;
	}

	/**
	 * Rotate to the next available credential.
	 */
	public async rotateCredentials(): Promise<void> {
		const userConfigManager = new UserConfigManager(this.env, this.apiKey);
		const userConfig = await userConfigManager.getConfig();

		if (!userConfig || !userConfig.gcpServiceAccounts || userConfig.gcpServiceAccounts.length === 0) {
			throw new Error("Cannot rotate credentials, no configuration found.");
		}

		const activeCredentials = userConfig.gcpServiceAccounts.filter(c => c !== null);
		if (activeCredentials.length === 0) {
			throw new Error("Cannot rotate credentials, no active credentials found.");
		}

		userConfig.currentCredentialIndex = (userConfig.currentCredentialIndex + 1) % activeCredentials.length;

		// Reset the request count for the new credential
		if (!userConfig.requestCounts) {
			userConfig.requestCounts = [];
		}
		userConfig.requestCounts[userConfig.currentCredentialIndex] = 0;

		await userConfigManager.setConfig(userConfig);
		this.accessToken = null; // Force re-authentication
	}
}
