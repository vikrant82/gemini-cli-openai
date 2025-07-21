import { Env } from "./types";

export class ConfigManager {
    private static instance: ConfigManager;
    private gcpServiceAccount: string;
    private initialized = false;
    public requestCount = 0;

    private constructor(private env: Env) {
        this.gcpServiceAccount = env.GCP_SERVICE_ACCOUNT;
    }

    public static getInstance(env: Env): ConfigManager {
        if (!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager(env);
        }
        return ConfigManager.instance;
    }

    public async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        const persistedConfig = await this.env.GEMINI_CLI_KV.get("GCP_SERVICE_ACCOUNT_CONFIG");
        if (persistedConfig) {
            this.gcpServiceAccount = persistedConfig;
        }
        this.initialized = true;
    }

    public getGcpServiceAccount(): string {
        return this.gcpServiceAccount;
    }

    public setGcpServiceAccount(gcpServiceAccount: string): void {
        this.gcpServiceAccount = gcpServiceAccount;
        this.requestCount = 0;
    }
}
