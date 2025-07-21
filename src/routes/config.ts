import { Hono } from "hono";
import { Env } from "../types";
import { ConfigManager } from "../config-manager";
import { AuthManager } from "../auth";

export const ConfigRoute = new Hono<{ Bindings: Env }>();

ConfigRoute.post("/config/update", async (c) => {
    const configManager = ConfigManager.getInstance(c.env);
    const authManager = new AuthManager(c.env);

    const body = await c.req.json();
    const newGcpServiceAccount = JSON.stringify(body);

    if (!body.access_token || !body.refresh_token) {
        return c.json({ error: "The request body must be a valid GCP service account JSON" }, 400);
    }

    configManager.setGcpServiceAccount(newGcpServiceAccount);
    await authManager.clearTokenCache();

    // Persist the new configuration in KV store
    await c.env.GEMINI_CLI_KV.put("GCP_SERVICE_ACCOUNT_CONFIG", newGcpServiceAccount);

    return c.json({ message: "Configuration updated and persisted successfully" });
});
