# Base project [readme](README_Orig.md)

# This fork adds Enhanced Credential Management and Multi-User Support

This document outlines the enhanced credential management system, which provides multi-user support, dynamic configuration, and automatic credential rotation to improve reliability and scalability.

## Key Features

-   **Multi-User Support**: The system supports multiple users, each with their own API key and a dedicated set of Google Cloud credentials.
-   **Dynamic Credential Management**:
    -   Each user can have multiple Google Cloud credentials, with the number of credentials configured by the `MAX_CREDENTIALS` environment variable.
    -   Credentials can be added or updated dynamically for each user without restarting the application.
-   **Automatic Credential Rotation**: The system automatically rotates to the next available credential for a user when it encounters a `429 Too Many Requests` error from the Gemini API, ensuring service continuity.
-   **Manual Rotation**: A dedicated endpoint allows for manually triggering credential rotation for a specific user.
-   **Persistent Configuration**: All user configurations, including their credentials and the current rotation state, are securely stored in the Cloudflare KV store.
-   **Two-Tiered Authentication**:
    -   A `MASTER_API_KEY` is used for administrative tasks like adding users and updating their credentials.
    -   User-specific API keys are used for accessing the core functionalities of the service.
-   **Per-Credential Statistics**: A debug endpoint (`/debug/stats`) provides detailed request counts for each credential, helping to monitor usage and rotation.

## How to Use

### 1. Registering a New User and Adding Credentials

To set up a new user or add/update credentials for an existing user, send a `POST` request to the `/v1/config/update` endpoint, authenticated with the `MASTER_API_KEY`.

**Example `curl` command:**

```bash
curl --request POST \
  --url http://localhost:8787/v1/config/update \
  --header 'Authorization: Bearer <your_master_api_key>' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "apiKey": "<the_users_api_key>",
    "gcpServiceAccount": {
        "refresh_token": "...",
        "client_id": "...",
        "client_secret": "...",
        "type": "authorized_user"
    }
}'
```

-   `apiKey`: The user's unique API key for accessing the service.
-   `gcpServiceAccount`: The Google Cloud service account JSON. You can add multiple credentials for a user by sending this request multiple times with different service account details.

### 2. Manually Rotating Credentials

To manually trigger a credential rotation for a specific user, send a `POST` request to the `/v1/config/rotate` endpoint.

**Example `curl` command:**

```bash
curl --request POST \
  --url http://localhost:8787/v1/config/rotate \
  --header 'Authorization: Bearer <your_master_api_key>' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "apiKey": "<the_users_api_key>"
}'
```

Once a user is registered, they can use their personal API key (`<the_users_api_key>`) to access all other service endpoints.