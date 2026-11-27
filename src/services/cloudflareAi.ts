const CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4/accounts";
const REQUEST_TIMEOUT_MS = 30_000;

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

export async function runCloudflareModel<T>(
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

export function readCloudflareTextResult(result: unknown): string {
	if (typeof result === "string") {
		return result.trim();
	}

	if (!isRecord(result)) {
		return "";
	}

	if (typeof result.response === "string") {
		return result.response.trim();
	}

	const choices = Array.isArray(result.choices) ? result.choices : [];
	const firstChoice = isRecord(choices[0]) ? choices[0] : undefined;
	const message = isRecord(firstChoice?.message) ? firstChoice.message : undefined;
	const content = message?.content;

	if (typeof content === "string") {
		return content.trim();
	}

	if (!Array.isArray(content)) {
		return "";
	}

	return content
		.map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
		.join("")
		.trim();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function requireEnvironmentVariable(name: string) {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`Missing ${name}`);
	}

	return value;
}
