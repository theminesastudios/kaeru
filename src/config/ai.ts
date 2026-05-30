import { GoogleGenAI } from "@google/genai";

import type { GenerateContentConfig } from "@google/genai";

export const KARU_AI = new GoogleGenAI({
	apiKey: process.env.KARU_API_KEY!,
});

export async function generateKaruText({
	model,
	contents,
	config,
}: {
	model: string | string[];
	contents: string;
	config?: GenerateContentConfig;
}) {
	const models = Array.isArray(model) ? model : [model];
	let lastError: unknown;

	for (const modelName of models) {
		try {
			const response = await KARU_AI.models.generateContent({
				model: modelName,
				contents,
				config,
			});

			return response.text?.trim() || "";
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError;
}

function extractJsonFromText(raw: string): string | null {
	const trimmed = raw.trim();

	if (
		trimmed.startsWith("{") && trimmed.endsWith("}") ||
		trimmed.startsWith("[") && trimmed.endsWith("]")
	) {
		return trimmed;
	}

	const fencedMatch = trimmed.match(
		/```(?:json)?\s*([\s\S]*?)\s*```/i,
	);
	if (fencedMatch) {
		return fencedMatch[1].trim();
	}

	let depth = 0;
	let inString = false;
	let escaped = false;
	let jsonStart = -1;

	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];

		if (inString) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (ch === "\\") {
				escaped = true;
				continue;
			}
			if (ch === '"') {
				inString = false;
			}
			continue;
		}

		if (ch === '"') {
			inString = true;
			continue;
		}

		if (ch === "{" || ch === "[") {
			if (jsonStart === -1) {
				jsonStart = i;
			}
			depth++;
			continue;
		}

		if (ch === "}" || ch === "]") {
			if (jsonStart === -1) {
				continue;
			}

			depth--;
			if (depth === 0) {
				return raw.slice(jsonStart, i + 1).trim();
			}
		}
	}

	return null;
}

export async function generateKaruJson<T>(args: {
	model: string | string[];
	contents: string;
	config?: GenerateContentConfig;
}) {
	const raw = await generateKaruText({
		...args,
		config: {
			...args.config,
			responseMimeType: "application/json",
		},
	});

	try {
		return JSON.parse(raw) as T;
	} catch {
		const json = extractJsonFromText(raw);
		if (json) {
			return JSON.parse(json) as T;
		}

		throw new Error("Invalid JSON response from AI");
	}
}
