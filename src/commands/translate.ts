import {
	CommandBuilder,
	CommandContext,
	IntegrationType,
	InteractionFlags,
} from "@minesa-org/mini-interaction";
import type { CommandInteraction, InteractionCommand } from "@minesa-org/mini-interaction";
import { queuePokeTranslation } from "../services/pokeTranslation.ts";
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
	"en-US": "Translate text into another language",
	"pt-BR": "Traduza texto para outro idioma",
	it: "Traduci il testo in un'altra lingua",
	de: "Übersetze Text in eine andere Sprache",
	"es-ES": "Traduce texto a otro idioma",
	fr: "Traduisez du texte dans une autre langue",
	ro: "Tradu textul în altă limbă",
	el: "Μετάφρασε κείμενο σε άλλη γλώσσα",
	ru: "Переведи текст на другой язык",
	"zh-CN": "将文本翻译成另一种语言",
	ja: "テキストを別の言語に翻訳",
	ko: "텍스트를 다른 언어로 번역",
};

const LANGUAGE_OPTION_NAME_LOCALIZATIONS = {
	"en-US": "language",
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
	"en-US": "Target language",
	"pt-BR": "Idioma de destino",
	it: "Lingua di destinazione",
	de: "Zielsprache",
	"es-ES": "Idioma de destino",
	fr: "Langue cible",
	ro: "Limba țintă",
	el: "Γλώσσα προορισμού",
	ru: "Целевой язык",
	"zh-CN": "目标语言",
	ja: "翻訳先の言語",
	ko: "대상 언어",
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
		.setDescription("Metni başka bir dile çevir")
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
				.setName("dil")
				.setNameLocalizations(LANGUAGE_OPTION_NAME_LOCALIZATIONS)
				.setDescription("Hedef dil")
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

		const languageInput = interaction.options.getString("dil")?.trim();
		const textInput = interaction.options.getString("metin")?.trim();

		if (!languageInput || !textInput) {
			return interaction.editReply({
				content: "Please provide both a target language and text to translate.",
			});
		}

		const targetLanguage = resolveTranslationLanguage(languageInput);

		try {
			await interaction.editReply({
				content: "Poke is translating your text…",
			});

			await queuePokeTranslation({
				text: textInput,
				targetLanguage,
				applicationId: interaction.application_id,
				interactionToken: interaction.token,
				responseStyle: "plain",
			});
		} catch (error) {
			log("error", "Failed to queue Poke translation:", error);

			return interaction.editReply({
				content:
					"Failed to send the translation request to Poke. Please try again shortly.",
			});
		}
	},
};

export default translate;
