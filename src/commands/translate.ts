import {
	CommandBuilder,
	CommandContext,
	ContainerBuilder,
	IntegrationType,
	InteractionFlags,
	TextDisplayBuilder,
} from "@minesa-org/mini-interaction";
import type { CommandInteraction, InteractionCommand } from "@minesa-org/mini-interaction";
import { generateKaruJson } from "../config/ai.ts";
import { getEmoji, log, sendAlertMessage } from "../utils/index.ts";
import { resolveTranslationLanguage } from "../utils/translationLanguages.ts";

const MAX_COMPONENT_TEXT_LENGTH = 3900;

function splitComponentText(text: string) {
	const chunks: string[] = [];
	let remaining = text.trim();

	while (remaining.length > MAX_COMPONENT_TEXT_LENGTH) {
		let splitIndex = remaining.lastIndexOf("\n", MAX_COMPONENT_TEXT_LENGTH);
		if (splitIndex < MAX_COMPONENT_TEXT_LENGTH * 0.5) {
			splitIndex = remaining.lastIndexOf(" ", MAX_COMPONENT_TEXT_LENGTH);
		}
		if (splitIndex <= 0) {
			splitIndex = MAX_COMPONENT_TEXT_LENGTH;
		}

		chunks.push(remaining.slice(0, splitIndex).trim());
		remaining = remaining.slice(splitIndex).trim();
	}

	if (remaining) {
		chunks.push(remaining);
	}

	return chunks;
}

function buildTranslationContainer(content: string) {
	return new ContainerBuilder().addComponent(new TextDisplayBuilder().setContent(content));
}

function formatCodeBlock(content: string) {
	const longestFence = content.match(/`{3,}/g)?.reduce((max, fence) => Math.max(max, fence.length), 2) ?? 2;
	const fence = "`".repeat(Math.max(3, longestFence + 1));

	return `${fence}\n${content}\n${fence}`;
}

const translate: InteractionCommand = {
	data: new CommandBuilder()
		.setName("çevir")
		.setNameLocalizations({
			"en-US": "translate",
		})
		.setDescription("Metni yapay zeka ile başka bir dile çevir")
		.setDescriptionLocalizations({
			"en-US": "Translate text into another language with AI",
		})
		.setIntegrationTypes([
			IntegrationType.UserInstall,
			IntegrationType.GuildInstall,
		])
		.setContexts([
			CommandContext.Bot,
			CommandContext.DM,
			CommandContext.Guild,
		])
		.addStringOption((opt) =>
			opt
				.setName("dil")
				.setNameLocalizations({
					"en-US": "language",
				})
				.setDescription("Hedef dil")
				.setDescriptionLocalizations({
					"en-US": "Target language",
				})
				.setRequired(true)
				.setMinLength(2)
				.setMaxLength(64)
				.setAutocomplete(true),
		)
		.addStringOption((opt) =>
			opt
				.setName("metin")
				.setNameLocalizations({
					"en-US": "text",
				})
				.setDescription("Çevrilecek metin")
				.setDescriptionLocalizations({
					"en-US": "Text to translate",
				})
				.setRequired(true)
				.setMinLength(1)
				.setMaxLength(4000),
		),

	handler: async (interaction: CommandInteraction) => {
		await interaction.deferReply({
			flags: InteractionFlags.Ephemeral | InteractionFlags.IsComponentsV2,
		});

		const languageInput = interaction.options.getString("dil")?.trim();
		const textInput = interaction.options.getString("metin")?.trim();

		if (!languageInput || !textInput) {
			return sendAlertMessage({
				interaction,
				content: "Please provide both a target language and text to translate.",
				type: "info",
			});
		}

		const targetLanguage = resolveTranslationLanguage(languageInput);

		const prompt = `
Translate the user's text into ${targetLanguage}.

Rules:
- Return only the translated text in the requested target language.
- Preserve meaning, tone, markdown, URLs, mentions, emoji, code blocks, and line breaks.
- Do not add explanations, notes, summaries, or quotation marks around the translation.
- If the text is already in ${targetLanguage}, still return a polished version in ${targetLanguage}.

Return ONLY valid JSON with this schema:
{
  "detectedLanguage": "detected source language",
  "targetLanguage": "resolved target language",
  "translation": "translated text"
}

Text:
"""${textInput}"""
`.trim();

		try {
			const parsed = await generateKaruJson<{
				detectedLanguage?: string;
				targetLanguage?: string;
				translation?: string;
			}>({
				model: "gemma-4-26b-a4b-it",
				contents: prompt,
				config: {
					temperature: 0.1,
					maxOutputTokens: 2048,
					topP: 0.8,
					topK: 20,
				},
			});

			const translation = parsed.translation?.trim();
			if (!translation) {
				throw new Error("Missing translation output");
			}

			const detectedLanguage = parsed.detectedLanguage?.trim() || "Unknown";
			const resolvedTargetLanguage = parsed.targetLanguage?.trim() || targetLanguage;
			const output = [
				`## ${getEmoji("globe")} Çeviri`,
				`-# ${detectedLanguage} → ${resolvedTargetLanguage}`,
				"",
				formatCodeBlock(translation),
			].join("\n");
			const chunks = splitComponentText(output);

			await interaction.editReply({
				components: [buildTranslationContainer(chunks[0])],
			});

			for (let i = 1; i < chunks.length; i++) {
				await interaction.followUp({
					components: [buildTranslationContainer(chunks[i])],
					flags: InteractionFlags.Ephemeral | InteractionFlags.IsComponentsV2,
				});
			}
		} catch (error) {
			log("error", "Failed to execute translate command:", error);

			return sendAlertMessage({
				interaction,
				content:
					"Failed to translate with Karu. The system might be confused - try again in a moment.",
				type: "error",
				tag: "AI Issue",
			});
		}
	},
};

export default translate;
