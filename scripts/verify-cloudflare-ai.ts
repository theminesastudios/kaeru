import assert from "node:assert/strict";

process.env.CLOUDFLARE_ACCOUNT_ID ||= "test-account";
process.env.CLOUDFLARE_AI_TOKEN ||= "test-token";

const { generateCloudflareJson, generateCloudflareText } = await import(
	"../src/services/cloudflareTextGeneration.ts"
);
const { translateText } = await import("../src/services/cloudflareTranslation.ts");

function envelope(result: unknown) {
	return new Response(
		JSON.stringify({ success: true, result, errors: [], messages: [] }),
		{
			status: 200,
			headers: { "Content-Type": "application/json" },
		},
	);
}

function chatCompletion(content: string) {
	return { choices: [{ message: { role: "assistant", content } }] };
}

function installFetch(
	respond: (url: string) => unknown,
	calls?: Array<{ url: string; body: Record<string, unknown> }>,
) {
	globalThis.fetch = (async (input, init) => {
		const url = String(input);
		calls?.push({
			url,
			body: JSON.parse(String(init?.body || "{}")) as Record<string, unknown>,
		});
		return envelope(respond(url));
	}) as typeof fetch;
}

const originalFetch = globalThis.fetch;

try {
	const generationCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
	installFetch(
		() => chatCompletion('{"summary":"hello","keyPoints":["one"]}'),
		generationCalls,
	);
	const json = await generateCloudflareJson<{
		summary?: string;
		keyPoints?: string[];
	}>({
		messages: [{ role: "user", content: "test" }],
	});
	assert.equal(json.summary, "hello");
	assert.equal(json.keyPoints?.[0], "one");
	assert.match(generationCalls[0]?.url || "", /@cf\/google\/gemma-4-26b-a4b-it$/);
	assert.equal(
		(generationCalls[0]?.body.chat_template_kwargs as { enable_thinking?: boolean })
			?.enable_thinking,
		false,
	);

	installFetch(() => chatCompletion("Ticket title"), generationCalls);
	const text = await generateCloudflareText({
		messages: [{ role: "user", content: "test" }],
	});
	assert.equal(text, "Ticket title");

	installFetch(() => ({ response: '{"summary":"legacy"}' }));
	const legacy = await generateCloudflareJson<{ summary?: string }>({
		messages: [{ role: "user", content: "test" }],
	});
	assert.equal(legacy.summary, "legacy");

	installFetch(() => ({ summary: "direct" }));
	const direct = await generateCloudflareJson<{ summary?: string }>({
		messages: [{ role: "user", content: "test" }],
	});
	assert.equal(direct.summary, "direct");

	const translationCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
	installFetch((url) => {
		if (url.includes("gemma-4-26b-a4b-it")) return chatCompletion("turkish");
		return { translated_text: "How are you?" };
	}, translationCalls);
	const translated = await translateText({
		text: "merhaba nasılsın",
		targetLanguage: "english",
	});
	assert.equal(translated, "How are you?");
	assert.equal(translationCalls.length, 2);
	assert.match(translationCalls[0]?.url || "", /gemma-4-26b-a4b-it/);
	assert.match(translationCalls[1]?.url || "", /m2m100-1\.2b/);
	assert.equal(
		(translationCalls[0]?.body.chat_template_kwargs as { enable_thinking?: boolean })
			?.enable_thinking,
		false,
	);

	console.log("cloudflare AI verification passed");
} finally {
	globalThis.fetch = originalFetch;
}
