import {
	CommandBuilder,
	CommandContext,
	IntegrationType,
	InteractionFlags,
} from "@minesa-org/mini-interaction";
import type { CommandInteraction, InteractionCommand } from "@minesa-org/mini-interaction";
import { generateKaruJson } from "../config/ai.ts";
import { log } from "../utils/index.ts";
import { resolveTranslationLanguage } from "../utils/translationLanguages.ts";

const MAX_MESSAGE_TEXT_LENGTH = 2000;

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
	"en-US": "Translate text into another language with AI",
	"pt-BR": "Traduza texto para outro idioma com IA",
	it: "Traduci il testo in un'altra lingua con l'IA",
	de: "Übersetze Text mit KI in eine andere Sprache",
	"es-ES": "Traduce texto a otro idioma con IA",
	fr: "Traduisez du texte dans une autre langue avec l'IA",
	ro: "Tradu textul în altă limbă cu IA",
	el: "Μετάφρασε κείμενο σε άλλη γλώσσα με AI",
	ru: "Переведи текст на другой язык с ИИ",
	"zh-CN": "使用 AI 将文本翻译成另一种语言",
	ja: "AIでテキストを別の言語に翻訳",
	ko: "AI로 텍스트를 다른 언어로 번역",
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

function splitMessageText(text: string) {
	const chunks: string[] = [];
	let remaining = text.trim();

	while (remaining.length > MAX_MESSAGE_TEXT_LENGTH) {
		let splitIndex = remaining.lastIndexOf("\n", MAX_MESSAGE_TEXT_LENGTH);
		if (splitIndex < MAX_MESSAGE_TEXT_LENGTH * 0.5) {
			splitIndex = remaining.lastIndexOf(" ", MAX_MESSAGE_TEXT_LENGTH);
		}
		if (splitIndex <= 0) {
			splitIndex = MAX_MESSAGE_TEXT_LENGTH;
		}

		chunks.push(remaining.slice(0, splitIndex).trim());
		remaining = remaining.slice(splitIndex).trim();
	}

	if (remaining) {
		chunks.push(remaining);
	}

	return chunks;
}

const translate: InteractionCommand = {
	data: new CommandBuilder()
		.setName("translate")
		.setNameLocalizations(COMMAND_NAME_LOCALIZATIONS)
		.setDescription("Metni yapay zeka ile başka bir dile çevir")
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

			const chunks = splitMessageText(translation);

			await interaction.editReply({
				content: chunks[0],
			});

			for (let i = 1; i < chunks.length; i++) {
				await interaction.followUp({
					content: chunks[i],
					flags: InteractionFlags.Ephemeral,
				});
			}
		} catch (error) {
			log("error", "Failed to execute translate command:", error);

			return interaction.editReply({
				content:
					"Failed to translate with Karu. The system might be confused - try again in a moment.",
			});
		}
	},
};

export default translate;
