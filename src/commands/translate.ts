import {
	CommandBuilder,
	CommandContext,
	IntegrationType,
	InteractionFlags,
} from "@minesa-org/mini-interaction";
import type { CommandInteraction, InteractionCommand } from "@minesa-org/mini-interaction";
import { translateText } from "../services/cloudflareTranslation.ts";
import { deliverDiscordInteractionReply } from "../services/discordInteractionReply.ts";
import { log } from "../utils/index.ts";
import { resolveTranslationLanguage } from "../utils/translationLanguages.ts";

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
	"en-US": "Translate text into a selected language",
	"pt-BR": "Traduza texto para um idioma selecionado",
	it: "Traduci il testo in una lingua selezionata",
	de: "Übersetze Text in eine ausgewählte Sprache",
	"es-ES": "Traduce texto a un idioma seleccionado",
	fr: "Traduisez le texte dans une langue sélectionnée",
	ro: "Tradu textul într-o limbă selectată",
	el: "Μετάφρασε κείμενο σε επιλεγμένη γλώσσα",
	ru: "Переведи текст на выбранный язык",
	"zh-CN": "将文本翻译成所选语言",
	ja: "テキストを選択した言語に翻訳",
	ko: "텍스트를 선택한 언어로 번역",
};

const LANGUAGE_OPTION_NAME_LOCALIZATIONS = {
	tr: "dil",
	"pt-BR": "idioma",
	it: "lingua",
	de: "sprache",
	"es-ES": "idioma",
	fr: "langue",
	ro: "limba",
	el: "γλώσσα",
	ru: "язык",
	"zh-CN": "语言",
	ja: "言語",
	ko: "언어",
};

const LANGUAGE_OPTION_DESCRIPTION_LOCALIZATIONS = {
	"en-US": "Language to translate into",
	"pt-BR": "Idioma para o qual traduzir",
	it: "Lingua in cui tradurre",
	de: "Sprache, in die übersetzt werden soll",
	"es-ES": "Idioma al que traducir",
	fr: "Langue vers laquelle traduire",
	ro: "Limba în care se traduce",
	el: "Γλώσσα μετάφρασης",
	ru: "Язык перевода",
	"zh-CN": "目标翻译语言",
	ja: "翻訳先の言語",
	ko: "번역할 대상 언어",
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
		.setDescription("Metni seçilen dile çevir")
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
				.setName("language")
				.setNameLocalizations(LANGUAGE_OPTION_NAME_LOCALIZATIONS)
				.setDescription("Çevrilecek hedef dil")
				.setDescriptionLocalizations(LANGUAGE_OPTION_DESCRIPTION_LOCALIZATIONS)
				.setRequired(true)
				.setMinLength(2)
				.setMaxLength(64)
				.setAutocomplete(true),
		)
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

		const languageInput = interaction.options.getString("language")?.trim();
		const textInput = interaction.options.getString("metin")?.trim();
		if (!languageInput || !textInput) {
			return interaction.editReply({
				content: "Please provide both a target language and text to translate.",
			});
		}

		const targetLanguage = resolveTranslationLanguage(languageInput);

		try {
			await interaction.editReply({
				content: `Translating your text into ${targetLanguage}…`,
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
