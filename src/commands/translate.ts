import {
	CommandBuilder,
	CommandContext,
	IntegrationType,
	InteractionFlags,
} from "@minesa-org/mini-interaction";
import type { CommandInteraction, InteractionCommand } from "@minesa-org/mini-interaction";
import { translateText } from "../services/cloudflareTranslation.ts";
import { deliverDiscordInteractionReply } from "../services/discordInteractionReply.ts";
import { log, resolveDiscordLocaleLanguage } from "../utils/index.ts";

const COMMAND_NAME_LOCALIZATIONS = {
	tr: "çevir",
	"pt-BR": "traduzir",
	it: "traduci",
	de: "übersetzen",
	"es-ES": "traducir",
	fr: "traduire",
	ro: "traduce",
	el: "μετάφραση",
	ru: "перевести",
	"zh-CN": "翻译",
	ja: "翻訳",
	ko: "번역",
};

const COMMAND_DESCRIPTION_LOCALIZATIONS = {
	"en-US": "Translate text into your Discord language",
	"pt-BR": "Traduza texto para o idioma do seu Discord",
	it: "Traduci il testo nella lingua di Discord",
	de: "Übersetze Text in deine Discord-Sprache",
	"es-ES": "Traduce texto al idioma de tu Discord",
	fr: "Traduisez le texte dans la langue de votre Discord",
	ro: "Tradu textul în limba Discord",
	el: "Μετάφρασε κείμενο στη γλώσσα του Discord σου",
	ru: "Переведи текст на язык твоего Discord",
	"zh-CN": "将文本翻译成你的 Discord 语言",
	ja: "テキストをDiscordの言語に翻訳",
	ko: "텍스트를 Discord 언어로 번역",
};

const TEXT_OPTION_NAME_LOCALIZATIONS = {
	"en-US": "text",
	"pt-BR": "texto",
	it: "testo",
	de: "text",
	"es-ES": "texto",
	fr: "texte",
	ro: "text",
	el: "κείμενο",
	ru: "текст",
	"zh-CN": "文本",
	ja: "テキスト",
	ko: "텍스트",
};

const TEXT_OPTION_DESCRIPTION_LOCALIZATIONS = {
	"en-US": "Text to translate",
	"pt-BR": "Texto para traduzir",
	it: "Testo da tradurre",
	de: "Zu übersetzender Text",
	"es-ES": "Texto para traducir",
	fr: "Texte à traduire",
	ro: "Text de tradus",
	el: "Κείμενο για μετάφραση",
	ru: "Текст для перевода",
	"zh-CN": "要翻译的文本",
	ja: "翻訳するテキスト",
	ko: "번역할 텍스트",
};

const translate: InteractionCommand = {
	data: new CommandBuilder()
		.setName("translate")
		.setNameLocalizations(COMMAND_NAME_LOCALIZATIONS)
		.setDescription("Metni Discord diline çevir")
		.setDescriptionLocalizations(COMMAND_DESCRIPTION_LOCALIZATIONS)
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
				.setName("metin")
				.setNameLocalizations(TEXT_OPTION_NAME_LOCALIZATIONS)
				.setDescription("Çevrilecek metin")
				.setDescriptionLocalizations(TEXT_OPTION_DESCRIPTION_LOCALIZATIONS)
				.setRequired(true)
				.setMinLength(1)
				.setMaxLength(4000),
		),

	handler: async (interaction: CommandInteraction) => {
		await interaction.deferReply({
			flags: InteractionFlags.Ephemeral,
		});

		const textInput = interaction.options.getString("metin")?.trim();
		if (!textInput) {
			return interaction.editReply({
				content: "Please provide text to translate.",
			});
		}

		const targetLanguage = resolveDiscordLocaleLanguage(interaction.locale);

		try {
			await interaction.editReply({
				content: "Translating your text…",
			});

			const translatedText = await translateText({
				text: textInput,
				targetLanguage,
			});

			await deliverDiscordInteractionReply({
				applicationId: interaction.application_id,
				interactionToken: interaction.token,
				content: translatedText,
			});
		} catch (error) {
			log("error", "Cloudflare translation failed:", error);

			return interaction.editReply({
				content: "Translation failed. Please try again shortly.",
			});
		}
	},
};

export default translate;
