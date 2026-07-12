import { decodePokeTranslationState } from "../src/services/pokeTranslation.js";

const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
const MAX_DISCORD_CONTENT_LENGTH = 2000;
const MAX_TRANSLATION_LENGTH = 20_000;
const DISCORD_REQUEST_TIMEOUT_MS = 10_000;
const EPHEMERAL_FLAG = 1 << 6;
const COMPONENTS_V2_FLAG = 1 << 15;
const CONTAINER_COMPONENT_TYPE = 17;
const TEXT_DISPLAY_COMPONENT_TYPE = 10;

type HeaderMap =
	| Record<string, string | string[] | undefined>
	| {
			get(name: string): string | null;
	  };

type NodeRequest = {
	method?: string;
	body?: unknown;
	headers?: HeaderMap;
};

type NodeResponse = {
	statusCode?: number;
	setHeader?: (name: string, value: string) => void;
	end: (body?: string) => void;
	status?: (code: number) => NodeResponse;
	json?: (body: unknown) => void;
};

type CallbackPayload = {
	state: string;
	translation: string;
	detectedLanguage?: string;
};

export default async function handler(req: NodeRequest, res: NodeResponse) {
	if (req.method !== "POST") {
		res.setHeader?.("Allow", "POST");
		sendJson(res, 405, { error: "Method not allowed" });
		return;
	}

	try {
		const payload = parseCallbackPayload(req.body);
		const state = decodePokeTranslationState(payload.state);
		const translation = payload.translation.trim();

		if (!translation) {
			throw new HttpError(400, "Translation is empty");
		}

		if (translation.length > MAX_TRANSLATION_LENGTH) {
			throw new HttpError(413, "Translation is too long");
		}

		const output =
			state.responseStyle === "message-command"
				? `🌐 Translated from ${payload.detectedLanguage?.trim() || "Unknown"}\n\n${translation}`
				: translation;
		const chunks = splitDiscordText(output);

		await editOriginalDiscordReply({
			applicationId: state.applicationId,
			interactionToken: state.interactionToken,
			content: chunks[0],
			responseStyle: state.responseStyle,
		});

		for (let index = 1; index < chunks.length; index++) {
			await createDiscordFollowUp({
				applicationId: state.applicationId,
				interactionToken: state.interactionToken,
				content: chunks[index],
				responseStyle: state.responseStyle,
			});
		}

		sendJson(res, 200, { success: true });
	} catch (error) {
		const statusCode = error instanceof HttpError ? error.statusCode : 500;
		const message = error instanceof Error ? error.message : "Unknown error";
		console.error("[Poke webhook] Failed to deliver translation", message);
		sendJson(res, statusCode, { error: message });
	}
}

async function editOriginalDiscordReply({
	applicationId,
	interactionToken,
	content,
	responseStyle,
}: {
	applicationId: string;
	interactionToken: string;
	content: string;
	responseStyle: "plain" | "message-command";
}) {
	const webhookUrl = createDiscordWebhookUrl(applicationId, interactionToken);
	await sendDiscordRequest(`${webhookUrl}/messages/@original`, {
		method: "PATCH",
		body: JSON.stringify(createDiscordMessageBody(content, responseStyle)),
	});
}

async function createDiscordFollowUp({
	applicationId,
	interactionToken,
	content,
	responseStyle,
}: {
	applicationId: string;
	interactionToken: string;
	content: string;
	responseStyle: "plain" | "message-command";
}) {
	const webhookUrl = createDiscordWebhookUrl(applicationId, interactionToken);
	const messageBody = createDiscordMessageBody(content, responseStyle);
	messageBody.flags =
		responseStyle === "message-command"
			? EPHEMERAL_FLAG | COMPONENTS_V2_FLAG
			: EPHEMERAL_FLAG;

	await sendDiscordRequest(`${webhookUrl}?wait=true`, {
		method: "POST",
		body: JSON.stringify(messageBody),
	});
}

function createDiscordMessageBody(
	content: string,
	responseStyle: "plain" | "message-command",
): {
	content?: string;
	components?: Array<{
		type: number;
		components: Array<{ type: number; content: string }>;
	}>;
	flags?: number;
} {
	if (responseStyle === "plain") {
		return { content };
	}

	return {
		components: [
			{
				type: CONTAINER_COMPONENT_TYPE,
				components: [
					{
						type: TEXT_DISPLAY_COMPONENT_TYPE,
						content,
					},
				],
			},
		],
	};
}

async function sendDiscordRequest(url: string, init: RequestInit) {
	const response = await fetch(url, {
		...init,
		headers: {
			"Content-Type": "application/json",
			...(init.headers ?? {}),
		},
		signal: AbortSignal.timeout(DISCORD_REQUEST_TIMEOUT_MS),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(
			`Discord webhook request failed (${response.status}): ${body.slice(0, 300)}`,
		);
	}
}

function createDiscordWebhookUrl(
	applicationId: string,
	interactionToken: string,
) {
	return `${DISCORD_API_BASE_URL}/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(interactionToken)}`;
}

function parseCallbackPayload(body: unknown): CallbackPayload {
	const root = toRecord(parseBody(body));
	if (!root) {
		throw new HttpError(400, "Invalid JSON body");
	}

	const candidates = [
		root,
		toRecord(root.data),
		toRecord(root.callback),
		parseEmbeddedRecord(root.message),
	].filter((value): value is Record<string, unknown> => Boolean(value));

	const state = findString(candidates, ["state", "callbackState"]);
	const translation = findString(candidates, [
		"translation",
		"translatedText",
		"translated_text",
	]);
	const detectedLanguage = findString(candidates, [
		"detectedLanguage",
		"detected_language",
		"sourceLanguage",
	]);

	if (!state) {
		throw new HttpError(400, "Missing callback state");
	}

	if (!translation) {
		throw new HttpError(400, "Missing translation");
	}

	return { state, translation, detectedLanguage };
}

function parseBody(body: unknown): unknown {
	if (typeof body !== "string") {
		return body;
	}

	try {
		return JSON.parse(body) as unknown;
	} catch {
		return null;
	}
}

function parseEmbeddedRecord(value: unknown) {
	if (typeof value !== "string") {
		return null;
	}

	try {
		return toRecord(JSON.parse(value) as unknown);
	} catch {
		return null;
	}
}

function toRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function findString(
	records: Record<string, unknown>[],
	keys: string[],
): string | undefined {
	for (const record of records) {
		for (const key of keys) {
			const value = record[key];
			if (typeof value === "string" && value.trim()) {
				return value;
			}
		}
	}

	return undefined;
}

function splitDiscordText(text: string) {
	const chunks: string[] = [];
	let remaining = text.trim();

	while (remaining.length > MAX_DISCORD_CONTENT_LENGTH) {
		let splitIndex = remaining.lastIndexOf("\n", MAX_DISCORD_CONTENT_LENGTH);
		if (splitIndex < MAX_DISCORD_CONTENT_LENGTH * 0.5) {
			splitIndex = remaining.lastIndexOf(" ", MAX_DISCORD_CONTENT_LENGTH);
		}
		if (splitIndex <= 0) {
			splitIndex = MAX_DISCORD_CONTENT_LENGTH;
		}

		chunks.push(remaining.slice(0, splitIndex).trim());
		remaining = remaining.slice(splitIndex).trim();
	}

	if (remaining) {
		chunks.push(remaining);
	}

	return chunks;
}

function sendJson(res: NodeResponse, statusCode: number, body: unknown) {
	if (typeof res.status === "function" && typeof res.json === "function") {
		res.status(statusCode).json?.(body);
		return;
	}

	res.statusCode = statusCode;
	res.setHeader?.("Content-Type", "application/json; charset=utf-8");
	res.end(JSON.stringify(body));
}

class HttpError extends Error {
	constructor(
		public readonly statusCode: number,
		message: string,
	) {
		super(message);
		this.name = "HttpError";
	}
}
