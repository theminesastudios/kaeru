const REQUEST_TIMEOUT_MS = 10_000;

export type QueuePokeTranslationOptions = {
	text: string;
	targetLanguage: string;
	applicationId: string;
	interactionToken: string;
};

export async function queuePokeTranslation({
	text,
	targetLanguage,
	applicationId,
	interactionToken,
}: QueuePokeTranslationOptions) {
	const normalizedToken = interactionToken.trim();
	const response = await fetch(resolvePokeIngestUrl(), {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			interaction_token: normalizedToken,
			// Poke forwards this opaque backup unchanged. The callback prefers it
			// if the plain token was reformatted while passing through the LLM step.
			interaction_token_b64: Buffer.from(normalizedToken, "utf8").toString(
				"base64url",
			),
			application_id: applicationId.trim(),
			original_text: text,
			// Resolved from the invoking user's Discord client locale.
			target_language: targetLanguage,
		}),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});

	const responseBody = await response.text();
	if (!response.ok) {
		throw new Error(
			`Poke ingest request failed (${response.status}): ${(
				responseBody || response.statusText
			).slice(0, 300)}`,
		);
	}

	return responseBody;
}

function resolvePokeIngestUrl() {
	const value = process.env.POKE_INGEST_URL?.trim();
	if (!value) {
		throw new Error("Missing POKE_INGEST_URL");
	}

	const url = new URL(value);
	if (url.protocol !== "https:" && process.env.NODE_ENV === "production") {
		throw new Error("POKE_INGEST_URL must use HTTPS in production");
	}

	return url.toString();
}
