// Lets callers branch on the Discord status code instead of matching on the
// message text (e.g. "404" means the thread member was not there at all).
export class DiscordApiError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "DiscordApiError";
		this.status = status;
	}
}

export async function fetchDiscord(
	endpoint: string,
	token: string,
	isBot: boolean = false,
	method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE" = "GET",
	body: any = null,
	timeoutMs: number = 8000,
) {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(`https://discord.com/api/v10${endpoint}`, {
			method,
			headers: {
				Authorization: isBot ? `Bot ${token}` : `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: body ? JSON.stringify(body) : null,
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			const error = await response.text();
			throw new DiscordApiError(
				response.status,
				`Discord API error: ${response.status} ${error} (Method: ${method}, Endpoint: ${endpoint})`,
			);
		}

		if (response.status === 204) {
			return null;
		}

		return await response.json();
	} catch (error) {
		clearTimeout(timeoutId);
		if (error instanceof Error && error.name === "AbortError") {
			throw new Error(
				`Discord API request timed out after ${timeoutMs}ms (Method: ${method}, Endpoint: ${endpoint})`,
			);
		}
		throw error;
	}
}

export async function getOrCreateWebhookUrl(
	channelId: string,
	token: string,
	name: string = "TicketSystem",
): Promise<string | null> {
	try {
		const webhooks = await fetchDiscord(`/channels/${channelId}/webhooks`, token, true);
		let webhook = webhooks.find((wh: any) => wh.name === name);

		if (!webhook) {
			webhook = await fetchDiscord(`/channels/${channelId}/webhooks`, token, true, "POST", {
				name,
			});
		}

		if (webhook) {
			return `https://discord.com/api/webhooks/${webhook.id}/${webhook.token}`;
		}
		return null;
	} catch (error) {
		console.error(`Error in getOrCreateWebhookUrl for channel ${channelId}:`, error);
		return null;
	}
}
