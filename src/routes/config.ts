import { Hono } from "hono";
import { Env } from "../types";
import { UserConfigManager } from "../user-config-manager";
import { AuthManager } from "../auth";

export const ConfigRoute = new Hono<{ Bindings: Env }>();

ConfigRoute.post("/config/update", async (c) => {
	const body = await c.req.json();
	const { apiKey, gcpServiceAccount } = body;

	if (!apiKey || !gcpServiceAccount) {
		return c.json({ error: "The request body must contain 'apiKey' and 'gcpServiceAccount' properties" }, 400);
	}

	if (!gcpServiceAccount.refresh_token) {
		return c.json({ error: "The 'gcpServiceAccount' property must be a valid GCP service account JSON with a refresh_token" }, 400);
	}

	const userConfigManager = new UserConfigManager(c.env, apiKey);
	let userConfig = await userConfigManager.getConfig();

	const maxCredentials = c.env.MAX_CREDENTIALS || 10;
	if (!userConfig) {
		userConfig = {
			gcpServiceAccounts: [],
			currentCredentialIndex: 0,
			nextWriteIndex: 0,
			requestCounts: [],
			totalRequests: 0,
		};
	}

	const writeIndex = userConfig.nextWriteIndex;
	const newGcpServiceAccount = JSON.stringify(gcpServiceAccount);

	if (writeIndex >= userConfig.gcpServiceAccounts.length) {
		userConfig.gcpServiceAccounts.push(newGcpServiceAccount);
	} else {
		userConfig.gcpServiceAccounts[writeIndex] = newGcpServiceAccount;
	}
	
	userConfig.nextWriteIndex = (writeIndex + 1) % maxCredentials;

	await userConfigManager.setConfig(userConfig);

	// Clear the cache for the specific credential that was updated
	const authManager = new AuthManager(c.env, apiKey);
	await authManager.clearTokenCache(writeIndex);


	return c.json({ message: `Configuration for API key '${apiKey}' updated successfully at index ${writeIndex}` });
});

ConfigRoute.post("/config/rotate", async (c) => {
	const body = await c.req.json();
	const { apiKey } = body;

	if (!apiKey) {
		return c.json({ error: "The request body must contain 'apiKey'" }, 400);
	}

	const authManager = new AuthManager(c.env, apiKey);
	await authManager.rotateCredentials();

	return c.json({ message: `Credentials for API key '${apiKey}' rotated successfully` });
});
