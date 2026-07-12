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

import { queuePokeTranslation } from "../services/pokeTranslation.ts";

import {
	getEmoji,
	langMap,
	log,
	sendAlertMessage,
} from "../utils/index.ts";

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

			await interaction.editReply({
				components: [
					new ContainerBuilder().addComponent(
						new TextDisplayBuilder().setContent(
							`${getEmoji("globe")} Poke is translating this message…`,
						),
					),
				],
			});

			await queuePokeTranslation({
				text: safeMessage,
				targetLanguage: targetLang,
				applicationId: interaction.application_id,
				interactionToken: interaction.token,
				responseStyle: "message-command",
			});
		} catch (err) {
			log(
				"error",
				"Failed to queue Poke message translation:",
				err,
			);

			return sendAlertMessage({
				interaction,
				content:
					"Failed to send the translation request to Poke. Please try again shortly.",
				type: "error",
			});
		}
	},
};

export default messageTranslate;
