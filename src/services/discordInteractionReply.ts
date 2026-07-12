const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
const DISCORD_REQUEST_TIMEOUT_MS = 10_000;
const MAX_DISCORD_CONTENT_LENGTH = 2_000;
const MAX_TRANSLATION_LENGTH = 20_000;
const EPHEMERAL_FLAG = 1 << 6;

export type DeliverDiscordInteractionReplyOptions = {
	applicationId: string;
	interactionToken: string;
	content: string;
};

export async function deliverDiscordInteractionReply({
	applicationId,
	interactionToken,
	content,
}: DeliverDiscordInteractionReplyOptions) {
	const normalizedContent = content.trim();
	if (!normalizedContent) {
		throw new Error("Discord reply content must not be empty");
	}

	if (normalizedContent.length > MAX_TRANSLATION_LENGTH) {
		throw new Error("Discord reply content is too long");
	}

	const chunks = splitDiscordText(normalizedContent);
	const webhookUrl = createDiscordWebhookUrl(applicationId, interactionToken);

	await sendDiscordRequest(`${webhookUrl}/messages/@original`, {
		method: "PATCH",
		body: JSON.stringify(createDiscordMessageBody(chunks[0])),
	});

	for (const chunk of chunks.slice(1)) {
		await sendDiscordRequest(`${webhookUrl}?wait=true`, {
			method: "POST",
			body: JSON.stringify({
				...createDiscordMessageBody(chunk),
				flags: EPHEMERAL_FLAG,
			}),
		});
	}
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
		const responseBody = await response.text();
		throw new Error(
			`Discord webhook request failed (${response.status}): ${(
				responseBody || response.statusText
			).slice(0, 300)}`,
		);
	}
}

function createDiscordWebhookUrl(
	applicationId: string,
	interactionToken: string,
) {
	return `${DISCORD_API_BASE_URL}/webhooks/${encodeURIComponent(
		applicationId.trim(),
	)}/${encodeURIComponent(interactionToken.trim())}`;
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
