const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
const DISCORD_REQUEST_TIMEOUT_MS = 10_000;
const MAX_DISCORD_CONTENT_LENGTH = 2_000;
const MAX_TRANSLATION_LENGTH = 20_000;
const EPHEMERAL_FLAG = 1 << 6;

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

type PokeCallbackPayload = {
	interaction_token: string;
	application_id: string;
	original_text: string;
	target_language: string;
	translated_text: string;
};

export default async function handler(req: NodeRequest, res: NodeResponse) {
	if (req.method !== "POST") {
		res.setHeader?.("Allow", "POST");
		sendJson(res, 405, { error: "Method not allowed" });
		return;
	}

	try {
		const payload = parseCallbackPayload(req.body);
		const translatedText = payload.translated_text.trim();

		if (!translatedText) {
			throw new HttpError(400, "translated_text must not be empty");
		}

		if (translatedText.length > MAX_TRANSLATION_LENGTH) {
			throw new HttpError(413, "translated_text is too long");
		}

		const chunks = splitDiscordText(translatedText);
		await editOriginalDiscordReply(
			payload.application_id,
			payload.interaction_token,
			chunks[0],
		);

		for (const chunk of chunks.slice(1)) {
			await createDiscordFollowUp(
				payload.application_id,
				payload.interaction_token,
				chunk,
			);
		}

		sendJson(res, 200, {
			success: true,
			chunks: chunks.length,
			target_language: payload.target_language,
		});
	} catch (error) {
		const statusCode = error instanceof HttpError ? error.statusCode : 500;
		const message = error instanceof Error ? error.message : "Unknown error";
		console.error("[Poke webhook] Failed to deliver translation:", message);
		sendJson(res, statusCode, { error: message });
	}
}

async function editOriginalDiscordReply(
	applicationId: string,
	interactionToken: string,
	content: string,
) {
	const webhookUrl = createDiscordWebhookUrl(applicationId, interactionToken);
	await sendDiscordRequest(`${webhookUrl}/messages/@original`, {
		method: "PATCH",
		body: JSON.stringify(createDiscordMessageBody(content)),
	});
}

async function createDiscordFollowUp(
	applicationId: string,
	interactionToken: string,
	content: string,
) {
	const webhookUrl = createDiscordWebhookUrl(applicationId, interactionToken);
	await sendDiscordRequest(`${webhookUrl}?wait=true`, {
		method: "POST",
		body: JSON.stringify({
			...createDiscordMessageBody(content),
			flags: EPHEMERAL_FLAG,
		}),
	});
}

function createDiscordMessageBody(content: string) {
	return {
		content,
		allowed_mentions: {
			parse: [] as string[],
		},
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
		throw new HttpError(
			502,
			`Discord webhook request failed (${response.status}): ${(
				body || response.statusText
			).slice(0, 300)}`,
		);
	}
}

function createDiscordWebhookUrl(
	applicationId: string,
	interactionToken: string,
) {
	return `${DISCORD_API_BASE_URL}/webhooks/${encodeURIComponent(
		applicationId,
	)}/${encodeURIComponent(interactionToken)}`;
}

function parseCallbackPayload(body: unknown): PokeCallbackPayload {
	const parsedBody = parseBody(body);
	if (!isRecord(parsedBody)) {
		throw new HttpError(400, "Invalid JSON body");
	}

	return {
		interaction_token: requireString(parsedBody, "interaction_token", 1_000),
		application_id: requireString(parsedBody, "application_id", 32),
		original_text: requireString(parsedBody, "original_text", 20_000),
		target_language: requireString(parsedBody, "target_language", 128),
		translated_text: requireString(
			parsedBody,
			"translated_text",
			MAX_TRANSLATION_LENGTH,
		),
	};
}

function parseBody(body: unknown): unknown {
	if (typeof body === "string") {
		try {
			return JSON.parse(body) as unknown;
		} catch {
			return null;
		}
	}

	if (body instanceof Uint8Array) {
		try {
			return JSON.parse(Buffer.from(body).toString("utf8")) as unknown;
		} catch {
			return null;
		}
	}

	return body;
}

function requireString(
	record: Record<string, unknown>,
	key: keyof PokeCallbackPayload,
	maxLength: number,
) {
	const value = record[key];
	if (typeof value !== "string" || !value.trim()) {
		throw new HttpError(400, `${key} must be a non-empty string`);
	}

	if (value.length > maxLength) {
		throw new HttpError(413, `${key} is too long`);
	}

	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function splitDiscordText(text: string) {
	const chunks: string[] = [];
	let remaining = text.trim();

	while (remaining.length > MAX_DISCORD_CONTENT_LENGTH) {
		let splitIndex = remaining.lastIndexOf("\n", MAX_DISCORD_CONTENT_LENGTH);
		if (splitIndex < MAX_DISCORD_CONTENT_LENGTH / 2) {
			splitIndex = remaining.lastIndexOf(" ", MAX_DISCORD_CONTENT_LENGTH);
		}
		if (splitIndex <= 0) {
			splitIndex = MAX_DISCORD_CONTENT_LENGTH;
		}

		chunks.push(remaining.slice(0, splitIndex).trimEnd());
		remaining = remaining.slice(splitIndex).trimStart();
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
