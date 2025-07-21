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

	const newGcpServiceAccount = JSON.stringify(gcpServiceAccount);

	if (!gcpServiceAccount.access_token || !gcpServiceAccount.refresh_token) {
		return c.json({ error: "The 'gcpServiceAccount' property must be a valid GCP service account JSON" }, 400);
	}

	const userConfigManager = new UserConfigManager(c.env, apiKey);
	const authManager = new AuthManager(c.env, apiKey);

	await userConfigManager.setConfig({
		gcpServiceAccount: newGcpServiceAccount,
		requestCount: 0
	});
	await authManager.clearTokenCache();

	return c.json({ message: `Configuration for API key '${apiKey}' updated successfully` });
});
