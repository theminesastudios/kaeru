import {
	CommandContext,
	IntegrationType,
	InteractionFlags,
	MessageCommandBuilder,
} from "@minesa-org/mini-interaction";

import type {
	InteractionCommand,
	MessageContextMenuInteraction,
} from "@minesa-org/mini-interaction";

import { queuePokeTranslation } from "../services/pokeTranslation.ts";
import { log, resolveDiscordLocaleLanguage } from "../utils/index.ts";

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
			flags: InteractionFlags.Ephemeral,
		});

		const message = interaction.targetMessage;

		if (
			!message ||
			typeof message.content !== "string" ||
			!message.content.trim()
		) {
			return interaction.editReply({
				content: "This message has no readable text to translate.",
			});
		}

		try {
			const safeMessage = message.content
				.replace(/<a?:.+?:\d{18}>/g, "")
				.replace(/https?:\/\/\S+/g, "")
				.trim();

			if (!safeMessage) {
				return interaction.editReply({
					content: "This message only contains unsupported content.",
				});
			}

			const targetLanguage = resolveDiscordLocaleLanguage(interaction.locale);

			await interaction.editReply({
				content: "Poke is translating this message…",
			});

			await queuePokeTranslation({
				text: safeMessage,
				targetLanguage,
				applicationId: interaction.application_id,
				interactionToken: interaction.token,
			});
		} catch (err) {
			log(
				"error",
				"Failed to send message translation to Poke ingest:",
				err,
			);

			return interaction.editReply({
				content:
					"Failed to send the translation request to Poke. Please try again shortly.",
			});
		}
	},
};

export default messageTranslate;
