import {
	CommandContext,
	ContainerBuilder,
	IntegrationType,
	InteractionFlags,
	MessageCommandBuilder,
	TextDisplayBuilder,
} from "@minesa-org/mini-interaction";
import type {
	InteractionCommand,
	MessageContextMenuInteraction,
} from "@minesa-org/mini-interaction";
import { KARU_AI } from "../config/ai.ts";
import { getEmoji, langMap, log, sendAlertMessage } from "../utils/index.ts";

function splitMessageBy2000(str: string) {
	const chunks: string[] = [];
	for (let i = 0; i < str.length; i += 2000) {
		chunks.push(str.slice(i, i + 2000));
	}
	return chunks;
}

const messageTranslate: InteractionCommand = {
	data: new MessageCommandBuilder()
		.setName("message-translate")
		.setNameLocalizations({
			it: "Traduci Messaggio",
			tr: "Mesajı Çevir",
			ro: "Traduceți Mesajul",
			el: "Μετάφραση Μηνύματος",
			"zh-CN": "翻译消息",
			"pt-BR": "Traduzir Messaggio",
		})
		.setContexts([CommandContext.Guild, CommandContext.Bot, CommandContext.DM])
		.setIntegrationTypes([IntegrationType.GuildInstall, IntegrationType.UserInstall]),
	handler: async (interaction: MessageContextMenuInteraction) => {
		await interaction.deferReply({
			flags: [InteractionFlags.IsComponentsV2, InteractionFlags.Ephemeral],
		});

		const message = interaction.targetMessage;

		if (!message || typeof message.content !== "string" || message.content.trim() === "") {
			return sendAlertMessage({
				interaction,
				content:
					"This message seems to hold no content—nothing to translate so... this means nothing to translate. \n-# Message shouldn't be inside an embed or container telling it in case c:",
				type: "info",
			});
		}

		try {
			const safeMessage = message.content.replace(/<a?:.+?:\d{18}>/g, "").trim();

			const fullLocale = interaction.locale || "en-US";
			const intl = new Intl.Locale(fullLocale);
			const rawLang = intl.language.toLowerCase();

			const targetLang = langMap[fullLocale.toLowerCase()] || langMap[rawLang] || "english";

			const model = KARU_AI.getGenerativeModel({
				model: "gemma-4-26b-a4b-it",
				generationConfig: {
					temperature: 0.3,
					maxOutputTokens: 1200,
					topP: 1,
					topK: 1,
				},
			});

			const prompt = `
You are a professional translator fluent in both English and the target language (${targetLang}). Your task is to translate the entire input message naturally and accurately into ${targetLang}, preserving full meaning, tone, and implied emotions.

Clean and translate the entire message below:

Message:
${safeMessage}

Return exactly two sections, labeled as follows:

Cleaned:
[Corrected and cleaned original message, preserving paragraphs]

Translated:
[Natural, fluent translation of the entire message, preserving paragraphs]

Do NOT add anything else.
`.trim();

			const result = await model.generateContent(prompt);
			const raw = result.response.text().trim();

			const cleanedMatch = raw.match(/Cleaned:\s*([\s\S]*?)\nTranslated:/i);
			const translatedMatch = raw.match(/Translated:\s*([\s\S]*)/i);

			const cleaned = cleanedMatch?.[1]?.trim();
			const translated = translatedMatch?.[1]?.trim();

			if (!cleaned || !translated) {
				throw new Error("Malformed response from AI");
			}

			const formattedCleaned = cleaned.replace(/\\n/g, "\n");
			const formattedTranslated = translated.replace(/\\n/g, "\n");

			const finalOutput = `### ${getEmoji("globe")} Cleaned\n${formattedCleaned}\n\n### ${getEmoji("swap")} Translated\n${formattedTranslated}`;

			const chunks = splitMessageBy2000(finalOutput);

			await interaction.editReply({
				components: [
					new ContainerBuilder().addComponent(new TextDisplayBuilder().setContent(chunks[0])),
				],
			});

			for (let i = 1; i < chunks.length; i++) {
				await interaction.followUp({
					components: [
						new ContainerBuilder().addComponent(new TextDisplayBuilder().setContent(chunks[i])),
					],
					flags: [InteractionFlags.IsComponentsV2, InteractionFlags.Ephemeral],
				});
			}
		} catch (err) {
			log("error", "Failed to translate the message:", err);

			return sendAlertMessage({
				interaction,
				content: "Failed to translate Karu. The system might be confused — try again in a moment.",
				type: "error",
			});
		}
	},
};

export default messageTranslate;
