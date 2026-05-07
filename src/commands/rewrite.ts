import {
	CommandBuilder,
	IntegrationType,
	CommandContext,
	InteractionFlags,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
} from "@minesa-org/mini-interaction";
import type {
	InteractionCommand,
	CommandInteraction,
	MessageActionRowComponent,
} from "@minesa-org/mini-interaction";
import { KARU_AI } from "../config/ai.ts";
import {
	emojis,
	getEmoji,
	log,
	langMap,
	sendAlertMessage,
	containerTemplate,
} from "../utils/index.ts";

const rewrite: InteractionCommand = {
	data: new CommandBuilder()
		.setName("writing")
		.setNameLocalizations({
			it: "scrittura",
			tr: "yazım",
			"zh-CN": "写作",
			"pt-BR": "escrita",
			de: "schreiben",
		})
		.setDescription("AI-powered writing assistant")
		.setDescriptionLocalizations({
			it: "Assistente di scrittura basato su IA",
			tr: "Yapay zekâ destekli yazım asistanı",
			"zh-CN": "AI 驱动的写作助手",
			"pt-BR": "Assistente de escrita com IA",
			de: "KI-gestützter Schreibassistent",
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
		.addSubcommand((sub) =>
			sub
				.setName("rewrite")
				.setNameLocalizations({
					it: "riescrivere",
					tr: "yeniden-yaz",
					"zh-CN": "重写",
					"pt-BR": "reescrever",
					de: "umschreiben",
				})
				.setDescription("Rewrite your text in a specific tone/style")
				.setDescriptionLocalizations({
					it: "Riscrivi il tuo testo in un tono/stile specifico",
					tr: "Metninizi belirli bir üslupta yeniden yaz",
					"zh-CN": "以特定语气/风格改写你的文本",
					"pt-BR": "Reescreva seu texto em um tom/estilo específico",
					de: "Schreibe deinen Text in einem bestimmten Ton/Stil um",
				})
				.addStringOption((opt) =>
					opt
						.setName("text")
						.setNameLocalizations({
							it: "testo",
							tr: "metin",
							"zh-CN": "文本",
							"pt-BR": "texto",
							de: "text",
						})
						.setDescription("Your original text")
						.setDescriptionLocalizations({
							it: "Il tuo testo originale",
							tr: "Orijinal metniniz",
							"zh-CN": "你的原始文本",
							"pt-BR": "Seu texto original",
							de: "Dein ursprünglicher Text",
						})
						.setRequired(true)
				)
				.addStringOption((opt) =>
					opt
						.setName("style")
						.setNameLocalizations({
							it: "stile",
							tr: "stil",
							"zh-CN": "风格",
							"pt-BR": "estilo",
							de: "stil",
						})
						.setDescription("Tone/Style to apply")
						.setDescriptionLocalizations({
							it: "Tono/Style da applicare",
							tr: "Uygulanacak üslup/stil",
							"zh-CN": "要应用的语气/风格",
							"pt-BR": "Tom/estilo a aplicar",
							de: "Ton/Stil zum Anwenden",
						})
						.addChoices(
							{
								name: "Friendly",
								value: "friendly",
								name_localizations: {
									it: "😀 Amichevole",
									tr: "😀 Arkadaşça",
									"zh-CN": "😀 友好",
									"pt-BR": "😀 Amigável",
									de: "😀 Freundlich",
								},
							},
							{
								name: "Professional",
								value: "professional",
								name_localizations: {
									it: "💼 Professionale",
									tr: "💼 Profesyonel",
									"zh-CN": "💼 专业",
									"pt-BR": "💼 Profissional",
									de: "💼 Professional",
								},
							},
							{
								name: "Concise",
								value: "concise",
								name_localizations: {
									it: "✂️ Conciso",
									tr: "✂️ Kısaca",
									"zh-CN": "✂️ 简洁",
									"pt-BR": "✂️ Conciso",
									de: "✂️ Konkret",
								},
							},
							{
								name: "Expand",
								value: "expand",
								name_localizations: {
									it: "📈 Espandere",
									tr: "📈 Genişlet",
									"zh-CN": "📈 扩展",
									"pt-BR": "📈 Expandir",
									de: "📈 Erweitern",
								},
							},
						)
				)
		)
		.addSubcommand((sub) =>
			sub
				.setName("proofread")
				.setNameLocalizations({
					it: "correggi",
					tr: "yazım-düzelt",
					"zh-CN": "校对",
					"pt-BR": "revisão",
					de: "korrektur",
				})
				.setDescription("Proofread and correct grammar, clarity, structure")
				.setDescriptionLocalizations({
					it: "Correggi la grammatica, la chiarezza e la struttura",
					tr: "Yazım, dil bilgisi ve yapı hatalarını düzelt",
					"zh-CN": "校对并纠正语法、清晰度和结构",
					"pt-BR": "Revisar e corrigir gramática, clareza e estrutura",
					de: "Korrigiere Grammatik, Klarheit und Struktur",
				})
				.addStringOption((opt) =>
					opt
						.setName("text")
						.setNameLocalizations({
							it: "testo",
							tr: "metin",
							"zh-CN": "文本",
							"pt-BR": "texto",
							de: "text",
						})
						.setDescription("Text to proofread")
						.setDescriptionLocalizations({
							it: "Testo da correggere",
							tr: "Düzenlenecek metin",
							"zh-CN": "需要校对的文本",
							"pt-BR": "Texto a ser revisado",
							de: "Zu korrigierender Text",
						})
						.setRequired(true)
				)
		),

	handler: async (interaction: CommandInteraction) => {
		await interaction.deferReply({ flags: InteractionFlags.Ephemeral | InteractionFlags.IsComponentsV2 });

		const subcommand = interaction.options.getSubcommand();
		const input = interaction.options.getString("text");
		const style = interaction.options.getString("style");

		const userLocale = interaction.locale?.toLowerCase();
		const userLang = langMap[userLocale] || "english";

		let prompt = "";

		switch (subcommand) {
			case "rewrite":
				let styleInstruction = "";
				switch (style) {
					case "friendly":
						styleInstruction = "a friendly, approachable";
						break;
					case "professional":
						styleInstruction = "a professional, formal";
						break;
					case "concise":
						styleInstruction = "a concise and clear";
						break;
					case "expand":
						styleInstruction = "an expanded, detailed";
						break;
					default:
						styleInstruction = "a professional, formal";
				}
				prompt = `The user speaks ${userLang}. Rewrite the following text strictly in ${styleInstruction} tone. Do NOT add explanations, summaries, or new information. Preserve all original meaning and language. Only change the tone and style:\n"""${input}"""`;
				break;

			case "proofread":
				prompt = `The user speaks ${userLang}. Proofread and correct ONLY grammar, spelling, punctuation, clarity, and structure of the following text. Do NOT change tone, language, or add content. Output only the corrected text:\n"""${input}"""`;
				break;

			default:
				return sendAlertMessage({
					interaction,
					content: "It contains something not safe to share.",
					type: "error",
					tag: "AI Issue",
				});
		}

		try {
			const model = KARU_AI.getGenerativeModel({
				model: "gemini-1.5-flash",
				generationConfig: {
					temperature: 0.3,
					maxOutputTokens: 2048,
					topP: 0.9,
					topK: 10,
				},
			});

			const result = await model.generateContent(prompt);
			const output = result.response.text().trim();

			const row = new ActionRowBuilder<MessageActionRowComponent>().addComponents(
				new ButtonBuilder()
					.setLabel(
						`${subcommand?.charAt(0).toUpperCase()}${subcommand?.slice(1)} in ${style || userLang}`,
					)
					.setEmoji({ id: emojis.magic.id, name: emojis.magic.name })
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(true)
					.setCustomId("rewrite"),
			);

			await interaction.editReply({
				components: [
					row,
					containerTemplate({ tag: `${getEmoji("magic")} Re-writed Text`, description: output }),
				],
			});
		} catch (err) {
			log("error", "Failed to execute AI command:", err);

			return sendAlertMessage({
				interaction,
				content:
					"Failed to rewrite with Karu. The system might be confused — try again in a moment.",
				type: "error",
				tag: "AI Issue",
			});
		}
	},
};

export default rewrite;
