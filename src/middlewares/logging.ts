import { Context, Next } from "hono";
import { Env } from "../types";

/**
 * Logging middleware for request/response tracking
 *
 * Logs:
 * - Request start with method, path, and body (for POST/PUT/PATCH)
 * - Request completion with status code and duration
 * - Masks sensitive data in request bodies
 */
export const loggingMiddleware = async (c: Context<{ Bindings: Env }>, next: Next) => {
	const method = c.req.method;
	const path = c.req.path;
	const startTime = Date.now();
	const timestamp = new Date().toISOString();

	// Mask Authorization header
	let authLog = "";
	const authHeader = c.req.header("Authorization");
	if (authHeader) {
		if (authHeader.startsWith("Bearer ")) {
			const key = authHeader.substring(7);
			const maskedKey = key.length > 8 ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : "***";
			authLog = ` - Auth: Bearer ${maskedKey}`;
		} else {
			authLog = " - Auth: [Non-Bearer]";
		}
	}


	// Log request body for POST/PUT/PATCH requests
	let bodyLog = "";
	if (["POST", "PUT", "PATCH"].includes(method)) {
		try {
			// Clone the request to read the body without consuming it
			const clonedReq = c.req.raw.clone();
			const body = await clonedReq.text();

			// Truncate very long bodies and mask sensitive data
			const truncatedBody = body.length > 500 ? body.substring(0, 500) + "..." : body;
			// Mask potential API keys or tokens
			const maskedBody = truncatedBody.replace(/"(api_?key|token|authorization)":\s*"[^"]*"/gi, '"$1": "***"');
			bodyLog = ` - Body: ${maskedBody}`;
		} catch {
			bodyLog = " - Body: [unable to parse]";
		}
	}

	console.log(`[${timestamp}] ${method} ${path}${authLog}${bodyLog} - Request started`);

	await next();

	const duration = Date.now() - startTime;
	const status = c.res.status;
	const endTimestamp = new Date().toISOString();

	console.log(`[${endTimestamp}] ${method} ${path} - Completed with status ${status} (${duration}ms)`);
};
