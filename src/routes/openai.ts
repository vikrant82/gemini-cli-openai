import { Hono } from "hono";
import { Env, ChatCompletionRequest, ChatCompletionResponse } from "../types";
import { geminiCliModels, DEFAULT_MODEL, getAllModelIds } from "../models";
import { OPENAI_MODEL_OWNER } from "../config";
import { DEFAULT_THINKING_BUDGET } from "../constants";
import { AuthManager } from "../auth";
import { GeminiApiClient } from "../gemini-client";
import { createOpenAIStreamTransformer } from "../stream-transformer";
import { UserConfigManager } from "../user-config-manager";

/**
 * OpenAI-compatible API routes for models and chat completions.
 */
export const OpenAIRoute = new Hono<{ Bindings: Env; Variables: { apiKey: string } }>();

// List available models
OpenAIRoute.get("/models", async (c) => {
	const modelData = getAllModelIds().map((modelId) => ({
		id: modelId,
		object: "model",
		created: Math.floor(Date.now() / 1000),
		owned_by: OPENAI_MODEL_OWNER
	}));

	return c.json({
		object: "list",
		data: modelData
	});
});

// Chat completions endpoint
OpenAIRoute.post("/chat/completions", async (c) => {
	try {
		console.log("Chat completions request received");
		const body = await c.req.json<ChatCompletionRequest>();
		const model = body.model || DEFAULT_MODEL;
		const messages = body.messages || [];
		// OpenAI API compatibility: stream defaults to true unless explicitly set to false
		const stream = body.stream !== false;

		// Check environment settings for real thinking
		const isRealThinkingEnabled = c.env.ENABLE_REAL_THINKING === "true";
		let includeReasoning = isRealThinkingEnabled; // Automatically enable reasoning when real thinking is enabled
		let thinkingBudget = body.thinking_budget ?? DEFAULT_THINKING_BUDGET; // Default to dynamic allocation

		// Newly added parameters
		const generationOptions = {
			max_tokens: body.max_tokens,
			temperature: body.temperature,
			top_p: body.top_p,
			stop: body.stop,
			presence_penalty: body.presence_penalty,
			frequency_penalty: body.frequency_penalty,
			seed: body.seed,
			response_format: body.response_format
		};

		// Handle effort level mapping to thinking_budget (check multiple locations for client compatibility)
		const reasoning_effort =
			body.reasoning_effort || body.extra_body?.reasoning_effort || body.model_params?.reasoning_effort;
		if (reasoning_effort) {
			includeReasoning = true; // Effort implies reasoning
			const isFlashModel = model.includes("flash");
			switch (reasoning_effort) {
				case "low":
					thinkingBudget = 1024;
					break;
				case "medium":
					thinkingBudget = isFlashModel ? 12288 : 16384;
					break;
				case "high":
					thinkingBudget = isFlashModel ? 24576 : 32768;
					break;
				case "none":
					thinkingBudget = 0;
					includeReasoning = false;
					break;
			}
		}

		const tools = body.tools;
		const tool_choice = body.tool_choice;

		console.log("Request body parsed:", {
			model,
			messageCount: messages.length,
			stream,
			includeReasoning,
			thinkingBudget,
			tools,
			tool_choice
		});

		if (!messages.length) {
			return c.json({ error: "messages is a required field" }, 400);
		}

		// Validate model
		if (!(model in geminiCliModels)) {
			return c.json(
				{
					error: `Model '${model}' not found. Available models: ${getAllModelIds().join(", ")}`
				},
				400
			);
		}

		// Check if the request contains images and validate model support
		const hasImages = messages.some((msg) => {
			if (Array.isArray(msg.content)) {
				return msg.content.some((content) => content.type === "image_url");
			}
			return false;
		});

		if (hasImages && !geminiCliModels[model].supportsImages) {
			return c.json(
				{
					error: `Model '${model}' does not support image inputs. Please use a vision-capable model like gemini-2.5-pro or gemini-2.5-flash.`
				},
				400
			);
		}

		// Extract system prompt and user/assistant messages
		let systemPrompt = "";
		const otherMessages = messages.filter((msg) => {
			if (msg.role === "system") {
				// Handle system messages with both string and array content
				if (typeof msg.content === "string") {
					systemPrompt = msg.content;
				} else if (Array.isArray(msg.content)) {
					// For system messages, only extract text content
					const textContent = msg.content
						.filter((part) => part.type === "text")
						.map((part) => part.text || "")
						.join(" ");
					systemPrompt = textContent;
				}
				return false;
			}
			return true;
		});

		// Initialize services
		const apiKey = c.get("apiKey");
		const userConfigManager = new UserConfigManager(c.env, apiKey);
		const authManager = new AuthManager(c.env, apiKey);
		const geminiClient = new GeminiApiClient(c.env, authManager);

		// Increment request count
		await userConfigManager.incrementRequestCount(authManager.getCurrentCredentialIndex());

		// Test authentication first
		try {
			await authManager.initializeAuth();
			console.log("Authentication successful");
		} catch (authError: unknown) {
			const errorMessage = authError instanceof Error ? authError.message : String(authError);
			console.error("Authentication failed:", errorMessage);
			return c.json({ error: "Authentication failed: " + errorMessage }, 401);
		}

        try {
            const projectId = await geminiClient.discoverProjectId();
            console.log(`Using Project ID: ${projectId}`);
        } catch (discoveryError: unknown) {
            console.error("Failed to discover Project ID for logging:", discoveryError);
        }

		if (stream) {
			// Streaming response
			const { readable, writable } = new TransformStream();
			const writer = writable.getWriter();
			const openAITransformer = createOpenAIStreamTransformer(model);
			const openAIStream = readable.pipeThrough(openAITransformer);

			// Asynchronously pipe data from Gemini to transformer
			(async () => {
				try {
					console.log("Starting stream generation");
					const geminiStream = geminiClient.streamContent(model, systemPrompt, otherMessages, {
						includeReasoning,
						thinkingBudget,
						tools,
						tool_choice,
						...generationOptions
					});

					for await (const chunk of geminiStream) {
						await writer.write(chunk);
					}
					console.log("Stream completed successfully");
					await writer.close();
				} catch (streamError: unknown) {
					const errorMessage = streamError instanceof Error ? streamError.message : String(streamError);
					console.error("Stream error:", errorMessage);
					// Try to write an error chunk before closing
					await writer.write({
						type: "text",
						data: `Error: ${errorMessage}`
					});
					await writer.close();
				}
			})();

			// Return streaming response
			console.log("Returning streaming response");
			return new Response(openAIStream, {
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
					"Access-Control-Allow-Origin": "*",
					"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
					"Access-Control-Allow-Headers": "Content-Type, Authorization"
				}
			});
		} else {
			// Non-streaming response
			try {
				console.log("Starting non-streaming completion");
				const completion = await geminiClient.getCompletion(model, systemPrompt, otherMessages, {
					includeReasoning,
					thinkingBudget,
					tools,
					tool_choice,
					...generationOptions
				});

				const response: ChatCompletionResponse = {
					id: `chatcmpl-${crypto.randomUUID()}`,
					object: "chat.completion",
					created: Math.floor(Date.now() / 1000),
					model: model,
					choices: [
						{
							index: 0,
							message: {
								role: "assistant",
								content: completion.content,
								tool_calls: completion.tool_calls
							},
							finish_reason: completion.tool_calls && completion.tool_calls.length > 0 ? "tool_calls" : "stop"
						}
					]
				};

				// Add usage information if available
				if (completion.usage) {
					response.usage = {
						prompt_tokens: completion.usage.inputTokens,
						completion_tokens: completion.usage.outputTokens,
						total_tokens: completion.usage.inputTokens + completion.usage.outputTokens
					};
				}

				console.log("Non-streaming completion successful");
				return c.json(response);
			} catch (completionError: unknown) {
				const errorMessage = completionError instanceof Error ? completionError.message : String(completionError);
				console.error("Completion error:", errorMessage);
				return c.json({ error: errorMessage }, 500);
			}
		}
	} catch (e: unknown) {
		const errorMessage = e instanceof Error ? e.message : String(e);
		console.error("Top-level error:", e);
		return c.json({ error: errorMessage }, 500);
	}
});
