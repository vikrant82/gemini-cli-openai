import { MiddlewareHandler } from "hono";
import { Env } from "../types";
import { UserConfigManager } from "../user-config-manager";

/**
 * Middleware to enforce user API key authentication.
 * Checks for 'Authorization: Bearer <key>' header and validates the key against the KV store.
 */
export const userApiKeyAuth: MiddlewareHandler<{ Bindings: Env; Variables: { apiKey: string } }> = async (c, next) => {
	const authHeader = c.req.header("Authorization");

	if (!authHeader) {
		return c.json(
			{
				error: {
					message: "Missing Authorization header",
					type: "authentication_error",
					code: "missing_authorization"
				}
			},
			401
		);
	}

	const match = authHeader.match(/^Bearer\s+(.+)$/);
	if (!match) {
		return c.json(
			{
				error: {
					message: "Invalid Authorization header format. Expected: Bearer <token>",
					type: "authentication_error",
					code: "invalid_authorization_format"
				}
			},
			401
		);
	}

	const providedKey = match[1];
	const userConfigManager = new UserConfigManager(c.env, providedKey);
	const userConfig = await userConfigManager.getConfig();

	if (!userConfig) {
		return c.json(
			{
				error: {
					message: "Invalid API key",
					type: "authentication_error",
					code: "invalid_api_key"
				}
			},
			401
		);
	}

	c.set("apiKey", providedKey);
	await next();
};

/**
 * Middleware to enforce master API key authentication for administrative endpoints.
 * Checks for 'Authorization: Bearer <key>' header and validates the key against the MASTER_API_KEY environment variable.
 */
export const masterApiKeyAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
	if (!c.env.MASTER_API_KEY) {
		return c.json(
			{
				error: {
					message: "Master API key is not configured",
					type: "server_error",
					code: "master_key_not_configured"
				}
			},
			500
		);
	}

	const authHeader = c.req.header("Authorization");

	if (!authHeader) {
		return c.json(
			{
				error: {
					message: "Missing Authorization header",
					type: "authentication_error",
					code: "missing_authorization"
				}
			},
			401
		);
	}

	const match = authHeader.match(/^Bearer\s+(.+)$/);
	if (!match) {
		return c.json(
			{
				error: {
					message: "Invalid Authorization header format. Expected: Bearer <token>",
					type: "authentication_error",
					code: "invalid_authorization_format"
				}
			},
			401
		);
	}

	const providedKey = match[1];
	if (providedKey !== c.env.MASTER_API_KEY) {
		return c.json(
			{
				error: {
					message: "Invalid master API key",
					type: "authentication_error",
					code: c.env.MASTER_API_KEY
				}
			},
			401
		);
	}

	await next();
};
