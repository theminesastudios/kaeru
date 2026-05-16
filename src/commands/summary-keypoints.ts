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
import { generateKaruJson } from "../config/ai.ts";
import {
	getEmoji,
	log,
	langMap,
	sendAlertMessage,
	containerTemplate,
} from "../utils/index.ts";

const summaryKeypoints: InteractionCommand = {
	data: new MessageCommandBuilder()
		.setName("Summary & Key Points")
		.setNameLocalizations({
			it: "Riepilogo & Punti Chiave",
			tr: "Özet & Ana Noktalar",
			ro: "Rezumat & Punctele Cheie",
			el: "Περίληψη & Κεντρικοί Πόντοι",
			"zh-CN": "摘要 & 关键点",
			"pt-BR": "Resumo & Pontos-chave",
		})
		.setIntegrationTypes([
			IntegrationType.UserInstall,
			IntegrationType.GuildInstall,
		])
		.setContexts([
			CommandContext.Bot,
			CommandContext.DM,
			CommandContext.Guild,
		]),

	handler: async (interaction: MessageContextMenuInteraction) => {
		await interaction.deferReply({
			flags: InteractionFlags.Ephemeral | InteractionFlags.IsComponentsV2,
		});

		const message = interaction.targetMessage;

		if (
			!message ||
			(typeof message.content !== "string" && !message.embeds?.length)
		) {
			return sendAlertMessage({
				interaction,
				content:
					"This message seems to hold no content—nothing to summarize. \n-# Message shouldn't be inside an embed or container telling it in case c:",
				tag: "Channel Type",
			});
		}

		try {
			let textToSummarize = "";

			if (message.content && message.content.trim() !== "") {
				textToSummarize += message.content.trim() + "\n";
			}

			if (message.embeds && message.embeds.length > 0) {
				for (const embed of message.embeds) {
					if (embed.title) textToSummarize += embed.title + "\n";
					if (embed.description) textToSummarize += embed.description + "\n";
					if (embed.fields) {
						for (const field of embed.fields) {
							textToSummarize += `${field.name}: ${field.value}\n`;
						}
					}
				}
			}

			if (textToSummarize.trim() === "") {
				return sendAlertMessage({
					interaction,
					content: `# ${getEmoji(
						"info",
					)} \nEmbeds, attachments or system messages can't be summarized. Maybe give it a try with a text message?`,
					tag: "Unsupported Message",
				});
			}

			const userLocale = interaction.locale?.toLowerCase() || "en-us";
			const targetLang = langMap[userLocale] || "English";

			const prompt = `
Summarize the following text into ONE clear, concise paragraph in ${targetLang}. Then extract the key points in ${targetLang}. Do NOT add opinions or extra details.

Return ONLY valid JSON with this schema:
{
  "summary": "summary paragraph",
  "keyPoints": ["point 1", "point 2", "point 3"]
}

Text:
"""${textToSummarize.trim()}"""
`.trim();

			const parsed = await generateKaruJson<{
				summary?: string;
				keyPoints?: string[];
			}>({
				model: "gemma-4-26b-a4b-it",
				contents: prompt,
				config: {
					temperature: 0.3,
					maxOutputTokens: 1024,
					topP: 0.9,
					topK: 10,
				},
			});

			const summary = parsed.summary?.trim();
			const keyPoints =
				parsed.keyPoints
					?.map((point) => point.trim())
					.filter(Boolean)
					.map((point) => `- ${point}`)
					.join("\n") || "No key points extracted.";

			if (!summary) {
				throw new Error("Missing summary output");
			}

			const summaryTextSection = `## ${getEmoji(
				"text_append",
			)} Summarized\n${summary}`;
			const keyPointsTextSection = `## ${getEmoji(
				"list_bullet",
			)} Key Points\n${keyPoints}`;

			await interaction.editReply({
				components: [
					containerTemplate({
						tag: "Summary & Key-Points System",
						description: [summaryTextSection, "", keyPointsTextSection],
					}),
				],
			});
		} catch (err) {
			log("error", "Failed to summarize the message:", err);

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

export default summaryKeypoints;
