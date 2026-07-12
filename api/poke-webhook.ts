const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
const DISCORD_REQUEST_TIMEOUT_MS = 10_000;
const MAX_DISCORD_CONTENT_LENGTH = 2_000;
const MAX_TRANSLATION_LENGTH = 20_000;
const EPHEMERAL_FLAG = 1 << 6;

type NodeRequest = {
	method?: string;
	body?: unknown;
};

type NodeResponse = {
	statusCode?: number;
	setHeader?: (name: string, value: string) => void;
	end: (body?: string) => void;
	status?: (code: number) => NodeResponse;
	json?: (body: unknown) => void;
};

type PokeCallbackPayload = {
	interaction_token_b64: string;
	application_id: string;
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
		const interactionToken = decodeInteractionToken(
			payload.interaction_token_b64,
		);
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
			interactionToken,
			chunks[0],
		);

		for (const chunk of chunks.slice(1)) {
			await createDiscordFollowUp(
				payload.application_id,
				interactionToken,
				chunk,
			);
		}

		sendJson(res, 200, {
			success: true,
			chunks: chunks.length,
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
		const invalidToken =
			response.status === 401 &&
			(body.includes("Invalid Webhook Token") || body.includes('"code": 50027'));

		throw new HttpError(
			502,
			invalidToken
				? "Discord rejected the decoded interaction token. Use a fresh interaction and ensure interaction_token_b64 and application_id originate from the same Discord interaction."
				: `Discord webhook request failed (${response.status}): ${(
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
		interaction_token_b64: requireString(
			parsedBody,
			"interaction_token_b64",
			2_000,
		),
		application_id: requireApplicationId(parsedBody),
		translated_text: requireString(
			parsedBody,
			"translated_text",
			MAX_TRANSLATION_LENGTH,
		),
	};
}

function decodeInteractionToken(encodedValue: string) {
	const normalizedInput = encodedValue.trim();
	if (!/^[A-Za-z0-9+/_-]+={0,2}$/u.test(normalizedInput)) {
		throw new HttpError(
			400,
			"interaction_token_b64 must be valid Base64 or Base64URL",
		);
	}

	const withoutPadding = normalizedInput.replace(/=+$/u, "");
	const canonicalBase64Url = withoutPadding
		.replaceAll("+", "-")
		.replaceAll("/", "_");

	let decodedToken: string;
	try {
		decodedToken = Buffer.from(canonicalBase64Url, "base64url").toString("utf8");
	} catch {
		throw new HttpError(400, "interaction_token_b64 could not be decoded");
	}

	if (
		!decodedToken ||
		decodedToken.length > 1_000 ||
		decodedToken !== decodedToken.trim() ||
		decodedToken.includes("\uFFFD")
	) {
		throw new HttpError(
			400,
			"interaction_token_b64 decodes to an invalid interaction token",
		);
	}

	const roundTrip = Buffer.from(decodedToken, "utf8").toString("base64url");
	if (roundTrip !== canonicalBase64Url) {
		throw new HttpError(400, "interaction_token_b64 failed validation");
	}

	return decodedToken;
}

function requireApplicationId(record: Record<string, unknown>) {
	const applicationId = requireString(record, "application_id", 32);
	if (!/^\d{17,20}$/u.test(applicationId)) {
		throw new HttpError(400, "application_id must be a Discord snowflake");
	}
	return applicationId;
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

	return value.trim();
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
