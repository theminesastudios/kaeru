import {
	isRecord,
	readCloudflareTextResult,
	runCloudflareModel,
} from "./cloudflareAi.ts";

const DEFAULT_TEXT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const DEFAULT_JSON_MODEL = "@cf/google/gemma-4-26b-a4b-it";

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

export async function generateCloudflareText({
	messages,
	model = DEFAULT_TEXT_MODEL,
	maxTokens = 512,
	temperature = 0.2,
}: GenerateCloudflareTextOptions): Promise<string> {
	assertMessages(messages);

	const result = await runCloudflareModel<unknown>(model, {
		messages,
		max_tokens: maxTokens,
		temperature,
		chat_template_kwargs: {
			enable_thinking: false,
		},
	});
	const text = readCloudflareTextResult(result);

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

	const result = await runCloudflareModel<unknown>(model, {
		messages,
		max_tokens: maxTokens,
		temperature,
		response_format: {
			type: "json_object",
		},
		chat_template_kwargs: {
			enable_thinking: false,
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

	if (isRecord(response) && !Array.isArray(response.choices)) {
		return response as T;
	}

	const text = readCloudflareTextResult(response);
	if (text) {
		const parsed = tryParseJson<T>(text);
		if (parsed !== undefined) return parsed;

		const preview = text.length > 300 ? `${text.slice(0, 300)}...` : text;
		throw new Error(`Cloudflare returned invalid JSON: ${preview}`);
	}

	throw new Error("Cloudflare returned an empty JSON generation response");
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
