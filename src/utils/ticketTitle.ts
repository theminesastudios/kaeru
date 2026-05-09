import { KARU_AI } from "../config/ai.ts";

const MAX_TITLE_WORDS = 8;
const MAX_THREAD_TITLE_LENGTH = 80;
const MAX_TITLE_OUTPUT_TOKENS = 16;

export async function summarizeTicketTitle(description: string): Promise<string> {
	try {
		const model = KARU_AI.getGenerativeModel({
			model: "gemma-4-26b-a4b-it",
			systemInstruction:
				"You create concise Discord support thread titles. Return only a specific title. Never include explanations, quotes, bullets, or ticket numbers.",
			generationConfig: {
				temperature: 0,
				maxOutputTokens: MAX_TITLE_OUTPUT_TOKENS,
				topK: 1,
				topP: 0.1,
			},
		});

		const result = await model.generateContent(
			`Maximum ${MAX_TITLE_WORDS} words. Issue: ${description}`,
		);
		const title = cleanTicketTitle(result.response.text());
		if (title) return title;
	} catch (error) {
		console.warn("[Kaeru] Failed to summarize ticket title with AI:", error);
	}

	return buildFallbackTitle(description);
}

export function cleanTicketTitle(input: string): string {
	const title = input
		.replace(/[\r\n]+/g, " ")
		.replace(/^["'`*\-:\s]+|["'`*\-:\s.?!]+$/g, "")
		.replace(/\s+/g, " ")
		.trim();

	return title
		.split(" ")
		.filter(Boolean)
		.slice(0, MAX_TITLE_WORDS)
		.join(" ")
		.slice(0, MAX_THREAD_TITLE_LENGTH)
		.trim();
}

function buildFallbackTitle(description: string): string {
	const words = description
		.replace(/[^\p{L}\p{N}\s'-]/gu, " ")
		.replace(/\s+/g, " ")
		.trim()
		.split(" ")
		.filter(Boolean)
		.slice(0, MAX_TITLE_WORDS);

	return cleanTicketTitle(words.join(" ")) || "Support request";
}
