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


function extractJsonCandidates(raw: string): string[] {
	const candidates: string[] = [];

	const add = (value: string | undefined | null) => {
		const candidate = value?.trim();
		if (candidate) {
			candidates.push(candidate);
		}
	};

	const trimmed = raw.trim();

	if (
		trimmed.startsWith("{") && trimmed.endsWith("}") ||
		trimmed.startsWith("[") && trimmed.endsWith("]")
	) {
		add(trimmed);
	}

	const fencedMatches = raw.matchAll(
		/```(?:json)?\s*([\s\S]*?)\s*```/gi,
	);
	for (const fencedMatch of fencedMatches) {
		if (
			fencedMatch[1]?.startsWith("{") ||
			fencedMatch[1]?.startsWith("[")
		) {
			add(fencedMatch[1]);
		}
	}

	let depth = 0;
	const expectedClosers: string[] = [];
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
			expectedClosers.push(ch === "{" ? "}" : "]");
			depth++;
			continue;
		}

		if (ch === "}" || ch === "]") {
			if (jsonStart === -1) {
				continue;
			}

			const expected = expectedClosers.pop();
			if (expected !== ch) {
				continue;
			}

			depth--;
			if (depth === 0) {
				add(raw.slice(jsonStart, i + 1));
				jsonStart = -1;
			}
		}
	}

	return candidates;
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
		for (const json of extractJsonCandidates(raw)) {
			try {
				return JSON.parse(json) as T;
			} catch {}
		}

		throw new Error("Invalid JSON response from AI");
	}
}
