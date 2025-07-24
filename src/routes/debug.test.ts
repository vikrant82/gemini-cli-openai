import { Hono } from "hono";
import { Env } from "../types";
import { DebugRoute } from "./debug";
import { ConfigRoute } from "./config";
import { UserConfig, UserConfigManager } from "../user-config-manager";
import { AuthManager } from "../auth";

interface StatsResponseBody {
    status: string;
    total_requests: number;
    requests_per_credential: number[];
}

// Mock the environment
const mockEnv = {
    GEMINI_CLI_KV: {
        get: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
    },
    MAX_CREDENTIALS: "5",
};

// Mock UserConfigManager
const mockUserConfigManager = {
    getConfig: jest.fn(),
    setConfig: jest.fn(),
    incrementRequestCount: jest.fn(),
};

jest.mock("../user-config-manager", () => {
    return {
        UserConfigManager: jest.fn().mockImplementation(() => {
            return mockUserConfigManager;
        }),
    };
});

describe("/debug/stats Endpoint", () => {
    let app: Hono<{ Bindings: Env; Variables: { apiKey: string } }>;
    const apiKey = "test-api-key";

    beforeEach(() => {
        jest.clearAllMocks();

        app = new Hono<{ Bindings: Env; Variables: { apiKey: string } }>();
        app.use("*", (c, next) => {
            c.set("apiKey", apiKey);
            return next();
        });
        app.route("/debug", DebugRoute);
        app.route("/config", ConfigRoute);

        // Reset user config before each test
        let userConfig: UserConfig = {
            gcpServiceAccounts: [],
            currentCredentialIndex: 0,
            nextWriteIndex: 0,
            requestCounts: [],
            totalRequests: 0,
        };
        mockUserConfigManager.getConfig.mockImplementation(async () => {
            return userConfig;
        });
        mockUserConfigManager.setConfig.mockImplementation(async (config: UserConfig) => {
            userConfig = config;
        });
    });

    it("should return the correct data structure and initial counts", async () => {
        const res = await app.request("/debug/stats", {
            method: "GET",
            headers: { "Content-Type": "application/json" },
        });

        expect(res.status).toBe(200);
        const body = await res.json() as StatsResponseBody;
        expect(body).toEqual({
            status: "ok",
            total_requests: 0,
            requests_per_credential: [],
        });
    });

    it("should increment request counts correctly", async () => {
        // Add a credential
        await app.request("/config/update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                apiKey,
                gcpServiceAccount: { refresh_token: "token-1" },
            }),
        });

        // Increment the request count
        const userConfig = await mockUserConfigManager.getConfig();
        if (userConfig) {
            userConfig.totalRequests = 1;
            userConfig.requestCounts[0] = 1;
        }

        const res = await app.request("/debug/stats", {
            method: "GET",
            headers: { "Content-Type": "application/json" },
        });

        expect(res.status).toBe(200);
        const body = await res.json() as StatsResponseBody;
        expect(body).toEqual({
            status: "ok",
            total_requests: 1,
            requests_per_credential: [1],
        });
    });

    it("should reset the counter for a credential when it's rotated", async () => {
        // Add two credentials
        let userConfig = await mockUserConfigManager.getConfig();
        if (userConfig) {
            userConfig.gcpServiceAccounts = [
                JSON.stringify({ refresh_token: "token-1" }),
                JSON.stringify({ refresh_token: "token-2" }),
            ];
            userConfig.nextWriteIndex = 2;
            await mockUserConfigManager.setConfig(userConfig);
        }

        // Increment the request count for the first credential
        userConfig = await mockUserConfigManager.getConfig();
        if (userConfig) {
            userConfig.totalRequests = 5;
            userConfig.requestCounts[0] = 5;
            await mockUserConfigManager.setConfig(userConfig);
        }

        // Rotate credentials
        const authManager = new AuthManager(mockEnv as unknown as Env, apiKey);
        await authManager.rotateCredentials();

        // After rotation, the counter for the new credential should be 0
        const res = await app.request("/debug/stats", {
            method: "GET",
            headers: { "Content-Type": "application/json" },
        });

        expect(res.status).toBe(200);
        const body = await res.json() as StatsResponseBody;
        expect(body.requests_per_credential[1]).toBe(0);
    });
});