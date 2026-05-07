import {
	CommandBuilder,
	CommandContext,
	IntegrationType,
	InteractionFlags,
} from "@minesa-org/mini-interaction";
import type {
	CommandInteraction,
	InteractionCommand,
} from "@minesa-org/mini-interaction";
import { KARU_AI } from "../config/ai.ts";
import {
	containerTemplate,
	getEmoji,
	log,
	sendAlertMessage,
} from "../utils/index.ts";

const timelapse: InteractionCommand = {
	data: new CommandBuilder()
		.setName("timelapse")
		.setDescription("See channel's summary using AI")
		.setNameLocalizations({
			tr: "zamanatlaması",
			ru: "таймлапс",
			de: "zeitraffer",
			it: "timelapse",
			"zh-CN": "延时",
			"pt-BR": "timelapse",
		})
		.setDescriptionLocalizations({
			tr: "YZ kullanarak kanalın özetini gör",
			ru: "Посмотреть сводку канала с помощью ИИ",
			de: "Siehe die Zusammenfassung des Kanals mit KI",
			it: "Vedi il riepilogo del canale usando l'IA",
			"zh-CN": "使用AI查看频道摘要",
			"pt-BR": "Veja o resumo do canal usando IA",
		})
		.addStringOption((option) =>
			option
				.setName("ephemeral")
				.setNameLocalizations({
					tr: "geçici",
					ru: "эпфемерал",
					de: "ephemeral",
					it: "episodico",
					"zh-CN": "短暂",
					"pt-BR": "efêmero",
				})
				.setDescription("Make the message ephemeral")
				.setDescriptionLocalizations({
					tr: "Mesajı geçici yap",
					ru: "Сделать сообщение эфемеральным",
					de: "Mach die Nachricht ephemeral",
					it: "Rendi il messaggio episodico",
					"zh-CN": "使消息短暂",
					"pt-BR": "Tornar a mensagem efêmera",
					ro: "Faceți mesajul efemeră",
					el: "Κάντε το μήνυμα εφημερικό",
				})
				.addChoices(
					{ name: "Yes", value: "true" },
					{ name: "No", value: "false" },
				)
				.setRequired(false),
		)
		.setContexts([CommandContext.Guild])
		.setIntegrationTypes([IntegrationType.GuildInstall]),

	handler: async (interaction: CommandInteraction) => {
		const ephemeral = interaction.options.getString("ephemeral") === "true";

		await interaction.deferReply({
			flags: ephemeral
				? InteractionFlags.Ephemeral | InteractionFlags.IsComponentsV2
				: InteractionFlags.IsComponentsV2,
		});

		try {
			const channelId = interaction.channel_id;
			if (!channelId) {
				throw new Error("Channel ID missing.");
			}

			// Fetch last 30 messages using Discord API (v10)
			const res = await fetch(
				`https://discord.com/api/v10/channels/${channelId}/messages?limit=30`,
				{
					headers: {
						Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
					},
				},
			);

			if (!res.ok) {
				const errorData = await res.json().catch(() => ({}));
				log("error", "Failed to fetch messages:", errorData);
				return sendAlertMessage({
					interaction,
					content: `Kaeru can only summarize text and thread type channels. I might not have permission or the channel type is unsupported.\n\n> ${getEmoji("reactions.user.thumbsup")} Okay!`,
					type: "error",
					tag: "Channel Type",
				});
			}

			const messages: any[] = await res.json();

			if (!messages || messages.length === 0) {
				return sendAlertMessage({
					interaction,
					content: "No messages found in this channel to summarize.",
					type: "info",
					tag: "Empty Channel",
				});
			}

			// Discord returns latest messages first, we need chronological order for AI
			const contentArr = [...messages].reverse().map((msg) => {
				const name = msg.author?.global_name || msg.author?.username || "Unknown";
				return `${name}: ${msg.content}`;
			});

			const content = contentArr.join("\n");

			const fullPrompt = `
You are an AI assistant. Summarize the following Discord messages in a short, continuous text. 
Do not create lists, bullet points, or key points. Just condense the messages into a brief readable text.

Messages:
${content}
`;

			const model = KARU_AI.getGenerativeModel({
				model: "gemini-2.5-flash",
				generationConfig: {
					temperature: 0.2,
					maxOutputTokens: 800,
					topK: 1,
					topP: 1,
				},
			});

			const result = await model.generateContent(fullPrompt);
			const output = result.response.text().trim();

			if (!output) {
				throw new Error("No response text from model");
			}

			await interaction.editReply({
				components: [
					containerTemplate({
						tag: `${getEmoji("magic")} Kāru Timelapse Summary`,
						description: `>>> ${output}`,
						thumbnail:
							"https://media.discordapp.net/attachments/736571695170584576/1408561935041036298/Normal.png?ex=68aa3107&is=68a8df87&hm=dc29cb372f6f3f9429943429ac9db5d24772d4d2c54a7d40ddb9a6c1b9d6fc26&=&format=webp&quality=lossless&width=1410&height=1410",
					}),
				],
			});
		} catch (err) {
			log("error", "Failed to execute timelapse command:", err);

			return sendAlertMessage({
				interaction,
				content:
					"Failed to summarize with Karu. The system might be confused — try again in a moment.",
				type: "error",
				tag: "AI Issue",
			});
		}
	},
};

export default timelapse;
