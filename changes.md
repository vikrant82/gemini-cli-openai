# Changelog

## Dynamic Configuration of GCP_SERVICE_ACCOUNT

This update introduces a new feature that allows for dynamic configuration of the `GCP_SERVICE_ACCOUNT` without needing to restart the application. This is particularly useful for scenarios where you need to switch service accounts on the fly, for example, to handle API rate limits.

### New Features

- **Dynamic Configuration Endpoint:** A new endpoint, `/v1/config/update`, has been added. You can send a POST request to this endpoint with a new `GCP_SERVICE_ACCOUNT` JSON to update the configuration at runtime.

- **Cache Invalidation:** When a new `GCP_SERVICE_ACCOUNT` is provided, the existing `access_token` cache is automatically invalidated, forcing the application to use the new credentials for subsequent requests.

- **Configuration Persistence:** The updated `GCP_SERVICE_ACCOUNT` is persisted in the Cloudflare KV store. This ensures that the configuration is not lost when the server restarts. The application will first try to load the configuration from the KV store, and if it's not available, it will fall back to the `.dev.vars` file.

### How to Use

You can update the `GCP_SERVICE_ACCOUNT` by sending a POST request to the `/v1/config/update` endpoint.

**Example `curl` command:**

```bash
curl --request POST \
  --url http://localhost:8787/v1/config/update \
  --header 'authorization: Bearer YOUR_OPENAI_API_KEY' \
  --header 'content-type: application/json' \
  --data '{
  "access_token": "...",
  "refresh_token": "...",
  "scope": "...",
  "token_type": "...",
  "id_token": "...",
  "expiry_date": ...
}'
```

### File Changes

**New Files:**

- `src/config-manager.ts`: Manages the application configuration in memory.
- `src/routes/config.ts`: Defines the new `/v1/config/update` route.
- `changes.md`: This file.

**Modified Files:**

- `src/index.ts`:
    - Registered the new `/v1/config/update` route.
    - Added middleware to initialize the `ConfigManager` on every request.

- `src/auth.ts`:
    - Updated the `AuthManager` to get the `GCP_SERVICE_ACCOUNT` from the `ConfigManager` instead of the environment variables.

- `src/types.ts`:
    - Added `ConfigManager` to the `Env` interface.

- `package.json` and `yarn.lock`:
    - Added `@cloudflare/workers-types` and `itty-router-extras` as dev dependencies to resolve TypeScript errors.
