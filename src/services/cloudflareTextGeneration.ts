const CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4/accounts";
const DEFAULT_TEXT_MODEL = "@cf/meta/llama-3.2-1b-instruct";
const DEFAULT_JSON_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
const REQUEST_TIMEOUT_MS = 30_000;

export type CloudflareAiMessage = {
	role: "system" | "user" | "assistant";
	content: string;
};

export type GenerateCloudflareTextOptions = {
	messages: CloudflareAiMessage[];
	model?: string;
	maxTokens?: number;
	temperature?: number;
};

type CloudflareEnvelope<T> = {
	result?: T;
	success?: boolean;
	errors?: Array<{
		message?: string;
	}>;
	messages?: Array<{
		message?: string;
	}>;
};

type TextGenerationResult =
	| string
	| {
			response?: string;
	  };

type JsonGenerationResult<T> =
	| T
	| string
	| {
			response?: T | string;
	  };

export async function generateCloudflareText({
	messages,
	model = DEFAULT_TEXT_MODEL,
	maxTokens = 512,
	temperature = 0.2,
}: GenerateCloudflareTextOptions): Promise<string> {
	assertMessages(messages);

	const result = await runCloudflareModel<TextGenerationResult>(model, {
		messages,
		max_tokens: maxTokens,
		temperature,
	});
	const text =
		typeof result === "string" ? result.trim() : result.response?.trim() || "";

	if (!text) {
		throw new Error("Cloudflare returned an empty text generation response");
	}

	return text;
}

export async function generateCloudflareJson<T>({
	messages,
	model = DEFAULT_JSON_MODEL,
	maxTokens = 512,
	temperature = 0.2,
}: GenerateCloudflareTextOptions): Promise<T> {
	assertMessages(messages);

	const result = await runCloudflareModel<JsonGenerationResult<T>>(model, {
		messages,
		max_tokens: maxTokens,
		temperature,
		response_format: {
			type: "json_object",
		},
	});
	const response =
		isRecord(result) && "response" in result ? result.response : result;

	if (typeof response === "string") {
		const parsed = tryParseJson<T>(response);
		if (parsed !== undefined) return parsed;

		const preview =
			response.length > 300 ? `${response.slice(0, 300)}...` : response;
		throw new Error(`Cloudflare returned invalid JSON: ${preview}`);
	}

	if (response !== undefined && response !== null && typeof response === "object") {
		return response as T;
	}

	throw new Error("Cloudflare returned an empty JSON generation response");
}

async function runCloudflareModel<T>(
	model: string,
	input: Record<string, unknown>,
): Promise<T> {
	const accountId = requireEnvironmentVariable("CLOUDFLARE_ACCOUNT_ID");
	const apiToken = requireEnvironmentVariable("CLOUDFLARE_AI_TOKEN");
	const response = await fetch(
		`${CLOUDFLARE_API_BASE_URL}/${encodeURIComponent(accountId)}/ai/run/${model}`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(input),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		},
	);

	const responseBody = await response.text();
	let payload: CloudflareEnvelope<T> | undefined;

	try {
		payload = JSON.parse(responseBody) as CloudflareEnvelope<T>;
	} catch {
		throw new Error(
			`Cloudflare returned an invalid JSON response (${response.status})`,
		);
	}

	if (!response.ok || payload.success === false) {
		const errorMessage =
			payload.errors?.find((error) => error.message)?.message ||
			payload.messages?.find((message) => message.message)?.message ||
			response.statusText ||
			"Unknown Cloudflare error";

		throw new Error(
			`Cloudflare model request failed (${response.status}): ${errorMessage}`,
		);
	}

	if (payload.result === undefined) {
		throw new Error("Cloudflare model response did not include a result");
	}

	return payload.result;
}

function tryParseJson<T>(raw: string): T | undefined {
	const candidates = new Set<string>();
	const trimmed = raw.trim();
	if (trimmed) candidates.add(trimmed);

	for (const match of raw.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)) {
		if (match[1]?.trim()) candidates.add(match[1].trim());
	}

	const balancedJson = extractBalancedJson(raw);
	if (balancedJson) candidates.add(balancedJson);

	for (const candidate of candidates) {
		try {
			return JSON.parse(candidate) as T;
		} catch {}
	}

	return undefined;
}

function extractBalancedJson(raw: string): string | undefined {
	let start = -1;
	let inString = false;
	let escaped = false;
	const closers: string[] = [];

	for (let index = 0; index < raw.length; index++) {
		const character = raw[index];

		if (inString) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (character === "\\") {
				escaped = true;
				continue;
			}
			if (character === '"') inString = false;
			continue;
		}

		if (character === '"') {
			inString = true;
			continue;
		}

		if (character === "{" || character === "[") {
			if (start === -1) start = index;
			closers.push(character === "{" ? "}" : "]");
			continue;
		}

		if (character !== "}" && character !== "]") continue;
		if (closers.pop() !== character) return undefined;

		if (start !== -1 && closers.length === 0) {
			return raw.slice(start, index + 1);
		}
	}

	return undefined;
}

function assertMessages(messages: CloudflareAiMessage[]) {
	if (messages.length === 0) {
		throw new Error("Cloudflare text generation requires at least one message");
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function requireEnvironmentVariable(name: string) {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`Missing ${name}`);
	}

	return value;
}
