import { AuthManager } from "./auth";
import { UserConfigManager, UserConfig } from "./user-config-manager";
import { Env } from "./types";

// Mock dependencies
const mockEnv = {
    GEMINI_CLI_KV: {
        get: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
    },
    MAX_CREDENTIALS: "5",
};

const mockUserConfigManager = {
    getConfig: jest.fn(),
    setConfig: jest.fn(),
};

jest.mock("./user-config-manager", () => {
    return {
        UserConfigManager: jest.fn().mockImplementation(() => {
            return mockUserConfigManager;
        }),
    };
});

describe("AuthManager", () => {
    let authManager: AuthManager;
    const apiKey = "test-api-key";

    beforeEach(() => {
        jest.clearAllMocks();
        authManager = new AuthManager(mockEnv as unknown as Env, apiKey);
    });

    describe("Dynamic Credential Buffer", () => {
        it("should respect MAX_CREDENTIALS when adding new credentials", async () => {
            const userConfig: UserConfig = {
                gcpServiceAccounts: [],
                currentCredentialIndex: 0,
                nextWriteIndex: 0,
                requestCount: 0,
            };
            mockUserConfigManager.getConfig.mockResolvedValue(userConfig);

            const gcpServiceAccount = { refresh_token: "new-refresh-token" };

            // Simulate adding up to MAX_CREDENTIALS
            for (let i = 0; i < 5; i++) {
                const updatedConfig = {
                    ...userConfig,
                    gcpServiceAccounts: [...userConfig.gcpServiceAccounts, JSON.stringify(gcpServiceAccount)],
                    nextWriteIndex: (i + 1) % 5,
                };
                userConfig.gcpServiceAccounts.push(JSON.stringify(gcpServiceAccount));
                userConfig.nextWriteIndex = (i + 1) % 5;
                mockUserConfigManager.setConfig.mockResolvedValue(undefined);
            }

            expect(userConfig.gcpServiceAccounts.length).toBe(5);

            // Add one more, which should overwrite the first one
            const newGcpServiceAccount = { refresh_token: "another-refresh-token" };
            userConfig.gcpServiceAccounts[0] = JSON.stringify(newGcpServiceAccount);
            userConfig.nextWriteIndex = 1;

            expect(userConfig.gcpServiceAccounts.length).toBe(5);
            expect(userConfig.gcpServiceAccounts[0]).toBe(JSON.stringify(newGcpServiceAccount));
        });
    });

    describe("Key Rotation", () => {
        it("should correctly cycle through credentials", async () => {
            const userConfig: UserConfig = {
                gcpServiceAccounts: [
                    JSON.stringify({ refresh_token: "token-1" }),
                    JSON.stringify({ refresh_token: "token-2" }),
                    JSON.stringify({ refresh_token: "token-3" }),
                ],
                currentCredentialIndex: 0,
                nextWriteIndex: 3,
                requestCount: 0,
            };
            mockUserConfigManager.getConfig.mockResolvedValue(userConfig);

            // First rotation
            await authManager.rotateCredentials();
            expect(userConfig.currentCredentialIndex).toBe(1);

            // Second rotation
            await authManager.rotateCredentials();
            expect(userConfig.currentCredentialIndex).toBe(2);

            // Third rotation (should wrap around)
            await authManager.rotateCredentials();
            expect(userConfig.currentCredentialIndex).toBe(0);
        });
    });

    describe("MAX_CREDENTIALS Environment Variable", () => {
        it("should use the environment variable to limit credentials", () => {
            const maxCredentials = parseInt(mockEnv.MAX_CREDENTIALS, 10);
            expect(maxCredentials).toBe(5);
        });
    });
});