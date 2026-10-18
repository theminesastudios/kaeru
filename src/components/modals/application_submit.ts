import { InteractionFlags, MessageFlags } from "@minesa-org/mini-interaction";
import type { InteractionModal, ModalSubmitInteraction } from "@minesa-org/mini-interaction";
import { fetchDiscord } from "../../utils/discord.ts";
import { getEmoji } from "../../utils/index.ts";
import { getInteractionUser } from "../../utils/ticketControls.ts";
import {
	APPLICATION_SLOTS,
	TRANSCRIPT_FILENAME,
	applicationQuestionFieldId,
	applicationSubmitModalId,
	buildAnswersTranscript,
	buildReviewComponents,
	getApplicationConfig,
	hasPendingApplication,
	markPendingApplication,
	reviewAnswersNeedTranscript,
	sanitizeFilename,
	saveApplicationRecord,
	sendDiscordMessageWithFiles,
} from "../../utils/application.ts";
import type { ApplicationAnswer, ApplicationQuestion, ApplicationRecord } from "../../utils/application.ts";

// Bots can always upload up to 10 MiB; anything larger stays a link.
const MAX_REUPLOAD_BYTES = 10 * 1024 * 1024;

type UploadFile = { filename: string; bytes: ArrayBuffer; contentType: string };

function pickOptionLabels(question: ApplicationQuestion, values: string[]) {
	return values
		.map((value) => question.options[Number(value)])
		.filter((label): label is string => typeof label === "string");
}

async function readAnswer(
	interaction: ModalSubmitInteraction,
	question: ApplicationQuestion,
	index: number,
	files: UploadFile[],
): Promise<ApplicationAnswer> {
	const customId = applicationQuestionFieldId(index);

	switch (question.type) {
		case "paragraph":
			return { label: question.label, answer: interaction.getTextFieldValue(customId)?.trim() ?? "" };

		case "radio": {
			const value = interaction.getRadioGroupValue(customId);
			return {
				label: question.label,
				answer: value === undefined ? "" : (pickOptionLabels(question, [value])[0] ?? ""),
			};
		}

		case "checkbox": {
			if (question.options.length === 0) {
				return { label: question.label, answer: interaction.getCheckboxValue(customId) ? "Yes" : "No" };
			}

			const labels = pickOptionLabels(question, interaction.getCheckboxGroupValues(customId));
			return { label: question.label, answer: labels.map((label) => `• ${label}`).join("\n") };
		}

		case "attachment": {
			const attachment = interaction.getAttachment(customId);
			if (!attachment) return { label: question.label, answer: "" };

			const filename = `q${index + 1}_${sanitizeFilename(attachment.filename, "file")}`;

			// Modal upload URLs are short-lived, so the file is copied into
			// the review message to keep it viewable for later reviewers.
			if (attachment.size <= MAX_REUPLOAD_BYTES) {
				try {
					const response = await fetch(attachment.url);
					if (response.ok) {
						files.push({
							filename,
							bytes: await response.arrayBuffer(),
							contentType:
								attachment.content_type ??
								response.headers.get("content-type") ??
								"application/octet-stream",
						});

						return {
							label: question.label,
							answer: `\`${attachment.filename}\``,
							attachment: { filename, contentType: attachment.content_type ?? null },
						};
					}
				} catch (error) {
					console.warn("[application] Failed to copy attachment:", error);
				}
			}

			return { label: question.label, answer: `[${attachment.filename}](${attachment.url})` };
		}
	}
}

function createSubmitModal(slot: number): InteractionModal {
	return {
		customId: applicationSubmitModalId(slot),

		handler: async (interaction) => {
			const guildId = interaction.guild_id;
			const user = getInteractionUser(interaction);
			if (!guildId || !user) return;

			await interaction.deferReply({ flags: InteractionFlags.Ephemeral });

			const config = await getApplicationConfig(guildId);
			const button = config?.buttons[slot - 1];

			if (!config?.reviewChannelId || !button) {
				return interaction.editReply({
					content: `${getEmoji("error")} This application was closed while you were filling it in.`,
				});
			}

			// Covers double submits and a second form opened before the first
			// one was sent.
			if (await hasPendingApplication(guildId, user.id, slot)) {
				return interaction.editReply({
					content: `${getEmoji("timer")} You already have a **${button.label}** application waiting for review.`,
				});
			}

			// A lone checkbox cannot be marked required in the modal itself.
			const unconfirmed = button.questions.find(
				(question, index) =>
					question?.type === "checkbox" &&
					question.required &&
					question.options.length === 0 &&
					!interaction.getCheckboxValue(applicationQuestionFieldId(index)),
			);

			if (unconfirmed) {
				return interaction.editReply({
					content: `${getEmoji("error")} You need to tick **${unconfirmed.label}** to apply. Please open the form again.`,
				});
			}

			const files: UploadFile[] = [];
			const answers: ApplicationAnswer[] = [];

			for (const [index, question] of button.questions.entries()) {
				if (!question) continue;
				answers.push(await readAnswer(interaction, question, index, files));
			}

			const guild = await fetchDiscord(`/guilds/${guildId}`, process.env.DISCORD_BOT_TOKEN!, true).catch(
				() => null,
			);

			const record: ApplicationRecord = {
				guildId,
				guildName: typeof guild?.name === "string" ? guild.name : null,
				userId: user.id,
				username: user.username ?? null,
				slot,
				buttonLabel: button.label,
				answers,
				submittedAt: Date.now(),
				status: "pending",
			};

			const hasTranscript = reviewAnswersNeedTranscript(answers);
			if (hasTranscript) {
				files.push({
					filename: TRANSCRIPT_FILENAME,
					bytes: new TextEncoder().encode(buildAnswersTranscript(record)).buffer as ArrayBuffer,
					contentType: "text/plain; charset=utf-8",
				});
			}

			try {
				const message = await sendDiscordMessageWithFiles(
					"POST",
					`/channels/${config.reviewChannelId}/messages`,
					{
						components: buildReviewComponents(record, { hasTranscript }),
						flags: MessageFlags.IsComponentsV2,
						allowed_mentions: { parse: [] },
					},
					files,
				);

				await Promise.all([
					saveApplicationRecord(message.id, record),
					markPendingApplication(guildId, user.id, slot, message.id),
				]);
			} catch (error) {
				console.error("[application] Failed to send application for review:", error);
				return interaction.editReply({
					content: `${getEmoji("error")} Your application could not be delivered to the staff. Please try again later or contact a moderator.`,
				});
			}

			return interaction.editReply({
				content: `${getEmoji("seal")} Your **${button.label}** application was sent. You will get a DM from me when staff review it.`,
			});
		},
	};
}

export default APPLICATION_SLOTS.map(createSubmitModal);
