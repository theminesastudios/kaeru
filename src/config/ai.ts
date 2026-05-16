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
		const json = raw.match(/\{[\s\S]*\}/)?.[0];

		if (json) {
			return JSON.parse(json) as T;
		}

		throw new Error("Invalid JSON response from AI");
	}
}
