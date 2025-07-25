
# Base project [readme](README_Orig.md)

# Changes from base project:

## Dynamic Credential Limit and Per-Credential Stats

This update enhances the credential management system by introducing a dynamic limit for the number of credentials and providing more detailed statistics.

### New Features

-   **Dynamic Credential Limit**: The hardcoded limit of 10 credentials has been removed. The system now supports a dynamic number of keys, configured via the `MAX_CREDENTIALS` environment variable.
-   **Per-Credential Stats**: The `/debug/stats` endpoint has been enhanced to provide per-credential request counts. It now shows the total number of requests and a breakdown of requests for each individual credential. The counter for a credential is reset when it's rotated.

---
## Automatic Credential Rotation

This update introduces a robust system for rotating Google Cloud OAuth credentials to automatically handle API rate limits and improve reliability.

### New Features

-   **Rotating Credentials:** The application now supports a list of up to 10 rotating GCP service account credentials for each user API key.
-   **Circular Configuration:** Credentials can be added or updated one by one via the `POST /v1/config/update` endpoint, which manages them in a circular array.
-   **Automatic Rotation on 429 Errors:** The system will automatically rotate to the next available credential when it receives a `429 Too Many Requests` error from the Gemini API.
-   **Manual Rotation Endpoint:** A new `POST /v1/config/rotate` endpoint has been added to allow for manual triggering of credential rotation.
-   **Persistent State:** The current state of the credential rotation (i.e., the active index) is persisted in the Cloudflare KV store, so it's not lost on restart.
-   **Enhanced Logging:** Added logging to show which credential is in use and when rotation occurs.

### How to Use

To add/update a credential, send a `POST` request to `/v1/config/update`. To manually rotate, send a `POST` request to `/v1/config/rotate`. Both endpoints are protected by the `MASTER_API_KEY`.

**Example `curl` to add/update a credential:**

```bash
curl --request POST \
  --url http://localhost:8787/v1/config/update \
  --header 'Authorization: Bearer <your_master_api_key>' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "apiKey": "<the_users_api_key>",
    "gcpServiceAccount": {
        "refresh_token": "...",
        ...
    }
}'
```

**Example `curl` to manually rotate credentials:**

```bash
curl --request POST \
  --url http://localhost:8787/v1/config/rotate \
  --header 'Authorization: Bearer <your_master_api_key>' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "apiKey": "<the_users_api_key>"
}'
```

### File Changes

-   **`src/user-config-manager.ts`**: Updated `UserConfig` to store an array of credentials and the current index.
-   **`src/routes/config.ts`**: Modified `/v1/config/update` logic and added the new `/v1/config/rotate` endpoint.
-   **`src/index.ts`**: Applied `masterApiKeyAuth` middleware to the new `/v1/config/rotate` route.
-   **`src/auth.ts`**: `AuthManager` was significantly updated to handle the list of credentials, implement rotation logic, and add logging.
-   **`src/gemini-client.ts`**: Added error handling for 429 errors to trigger automatic rotation.

---

## Per-Key Credentials and Multi-User Support

This major update refactors the application to support multiple users, each with their own API key and `GCP_SERVICE_ACCOUNT` credentials. This provides a more secure and scalable solution for multi-user environments.

### New Features

-   **Per-Key Credentials:** The application now associates each `OPENAI_API_KEY` with its own `GCP_SERVICE_ACCOUNT` configuration.
-   **Two-Tiered Authentication:**
    -   A `MASTER_API_KEY` (set in `.dev.vars`) is now used to protect the `/v1/config/update` endpoint.
    -   User-specific `OPENAI_API_KEY`s are used to authenticate with all other endpoints.
-   **User Self-Registration:** Users can register their own API keys and credentials by sending a `POST` request to the `/v1/config/update` endpoint, authenticated with the `MASTER_API_KEY`.
-   **KV Store for User Data:** All user-specific data, including configurations and access tokens, is now stored in the Cloudflare KV store, scoped by the user's API key.

### How to Use

To register or update a user's configuration, send a `POST` request to the `/v1/config/update` endpoint.

**Example `curl` command:**

```bash
curl --request POST \
  --url http://localhost:8787/v1/config/update \
  --header 'Authorization: Bearer <your_master_api_key>' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "apiKey": "<the_users_new_api_key>",
    "gcpServiceAccount": {
        "access_token": "...",
        "refresh_token": "...",
        "scope": "...",
        "token_type": "...",
        "id_token": "...",
        "expiry_date": ...
    }
}'
```

After registering, the user can use their personal API key (`<the_users_new_api_key>`) to access all other endpoints.

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
