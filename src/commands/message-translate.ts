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

import {
	getEmoji,
	langMap,
	log,
	sendAlertMessage,
} from "../utils/index.ts";

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
		.setContexts([
			CommandContext.Guild,
			CommandContext.Bot,
			CommandContext.DM,
		])
		.setIntegrationTypes([
			IntegrationType.GuildInstall,
			IntegrationType.UserInstall,
		]),

	handler: async (
		interaction: MessageContextMenuInteraction,
	) => {
		await interaction.deferReply({
			flags: [
				InteractionFlags.IsComponentsV2,
				InteractionFlags.Ephemeral,
			],
		});

		const message = interaction.targetMessage;

		if (
			!message ||
			typeof message.content !== "string" ||
			!message.content.trim()
		) {
			return sendAlertMessage({
				interaction,
				content:
					"This message has no readable text to translate.",
				type: "info",
			});
		}

		try {
			const safeMessage = message.content
				.replace(/<a?:.+?:\d{18}>/g, "")
				.replace(/https?:\/\/\S+/g, "")
				.trim();

			if (!safeMessage) {
				return sendAlertMessage({
					interaction,
					content:
						"This message only contains unsupported content.",
					type: "info",
				});
			}

			const fullLocale =
				interaction.locale || "en-US";

			const intl = new Intl.Locale(fullLocale);

			const rawLang =
				intl.language.toLowerCase();

			const targetLang =
				langMap[fullLocale.toLowerCase()] ||
				langMap[rawLang] ||
				"english";

			const model =
				KARU_AI.getGenerativeModel({
					model: "gemma-4-26b-a4b-it",

					generationConfig: {
						temperature: 0.1,
						maxOutputTokens: 250,
						topP: 0.8,
						topK: 20,
						responseMimeType:
							"application/json",
					},
				});

			const prompt = `
Translate the following message into ${targetLang}.

Return ONLY valid JSON.

Schema:
{
  "language": "detected language",
  "translation": "translated text"
}

Message:
${safeMessage}
`.trim();

			const result =
				await model.generateContent(prompt);

			const raw =
				result.response.text().trim();

			let parsed: {
				language?: string;
				translation?: string;
			};

			try {
				parsed = JSON.parse(raw);
			} catch {
				throw new Error(
					"Invalid JSON response from AI",
				);
			}

			const detectedLang =
				parsed.language?.trim() ||
				"Unknown";

			const translated =
				parsed.translation?.trim();

			if (!translated) {
				throw new Error(
					"Missing translation output",
				);
			}

			const finalOutput =
				`${getEmoji("globe")} Translated from ${detectedLang}\n\n${translated}`;

			const chunks =
				splitMessageBy2000(finalOutput);

			await interaction.editReply({
				components: [
					new ContainerBuilder().addComponent(
						new TextDisplayBuilder().setContent(
							chunks[0],
						),
					),
				],
			});

			for (let i = 1; i < chunks.length; i++) {
				await interaction.followUp({
					components: [
						new ContainerBuilder().addComponent(
							new TextDisplayBuilder().setContent(
								chunks[i],
							),
						),
					],

					flags: [
						InteractionFlags.IsComponentsV2,
						InteractionFlags.Ephemeral,
					],
				});
			}
		} catch (err) {
			log(
				"error",
				"Failed to translate message:",
				err,
			);

			return sendAlertMessage({
				interaction,

				content:
					"Failed to translate the message. Please try again shortly.",

				type: "error",
			});
		}
	},
};

export default messageTranslate;