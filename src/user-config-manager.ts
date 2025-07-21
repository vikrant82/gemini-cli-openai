import { Env } from "./types";

export interface UserConfig {
    gcpServiceAccount: string;
    requestCount: number;
}

export class UserConfigManager {
    private env: Env;
    private apiKey: string;

    constructor(env: Env, apiKey: string) {
        this.env = env;
        this.apiKey = apiKey;
    }

    public async getConfig(): Promise<UserConfig | null> {
        const configStr = await this.env.GEMINI_CLI_KV.get(`config:${this.apiKey}`);
        if (!configStr) {
            return null;
        }
        return JSON.parse(configStr);
    }

    public async setConfig(config: UserConfig): Promise<void> {
        await this.env.GEMINI_CLI_KV.put(`config:${this.apiKey}`, JSON.stringify(config));
    }

    public async incrementRequestCount(): Promise<void> {
        const config = await this.getConfig();
        if (config) {
            config.requestCount++;
            await this.setConfig(config);
        }
    }
}
