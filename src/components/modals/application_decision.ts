import { InteractionFlags } from "@minesa-org/mini-interaction";
import type { InteractionModal } from "@minesa-org/mini-interaction";
import { fetchDiscord } from "../../utils/discord.ts";
import { getEmoji } from "../../utils/index.ts";
import { getInteractionUser } from "../../utils/ticketControls.ts";
import {
	APPLICATION_APPROVE_MODAL_ID,
	APPLICATION_DECLINE_MODAL_ID,
	TRANSCRIPT_FILENAME,
	buildReviewComponents,
	canReviewApplications,
	clearPendingApplication,
	getApplicationConfig,
	getApplicationRecord,
	saveApplicationRecord,
	sendApplicationDecisionDm,
} from "../../utils/application.ts";

function createDecisionModal(decision: "approved" | "declined"): InteractionModal {
	return {
		customId: decision === "approved" ? APPLICATION_APPROVE_MODAL_ID : APPLICATION_DECLINE_MODAL_ID,

		handler: async (interaction) => {
			const guildId = interaction.guild_id;
			const reviewer = getInteractionUser(interaction);
			const message = interaction.message;
			if (!guildId || !reviewer) return;

			await interaction.deferReply({ flags: InteractionFlags.Ephemeral });

			if (!message) {
				return interaction.editReply({
					content: `${getEmoji("error")} I could not find the application this decision belongs to.`,
				});
			}

			const [config, record] = await Promise.all([
				getApplicationConfig(guildId),
				getApplicationRecord(message.id),
			]);

			// Checked again here because the modal can be submitted long after
			// the button was pressed.
			if (!canReviewApplications(interaction.member, config)) {
				return interaction.editReply({
					content: `${getEmoji("error")} You are no longer allowed to review applications.`,
				});
			}

			if (!record || record.guildId !== guildId) {
				return interaction.editReply({
					content: `${getEmoji("error")} This application is not stored anymore.`,
				});
			}

			if (record.status !== "pending") {
				return interaction.editReply({
					content: `${getEmoji("error")} <@${record.reviewerId}> already ${record.status} this application.`,
				});
			}

			record.status = decision;
			record.reviewerId = reviewer.id;
			record.decidedAt = Date.now();
			record.note = interaction.getTextFieldValue("note")?.trim() || null;
			record.dmDelivered = false;

			// Claim the decision before the slower DM call, so a second
			// reviewer submitting at the same time sees it as already decided.
			await saveApplicationRecord(message.id, record);

			try {
				await sendApplicationDecisionDm(record);
				record.dmDelivered = true;
			} catch (error) {
				console.warn("[application] Failed to DM applicant:", error);
			}

			await Promise.all([
				saveApplicationRecord(message.id, record),
				clearPendingApplication(record.guildId, record.userId, record.slot),
			]);

			try {
				const hasTranscript = (message.attachments ?? []).some(
					(attachment) => attachment.filename === TRANSCRIPT_FILENAME,
				);

				await fetchDiscord(
					`/channels/${message.channel_id}/messages/${message.id}`,
					process.env.DISCORD_BOT_TOKEN!,
					true,
					"PATCH",
					{
						components: buildReviewComponents(record, { hasTranscript }),
						// Listing the existing ids keeps the uploaded files, so the
						// redrawn components can keep pointing at them.
						attachments: (message.attachments ?? []).map((attachment) => ({ id: attachment.id })),
						allowed_mentions: { parse: [] },
					},
				);
			} catch (error) {
				console.error("[application] Failed to update review message:", error);
			}

			const verb = decision === "approved" ? "approved" : "declined";
			return interaction.editReply({
				content: record.dmDelivered
					? `${getEmoji("seal")} Application ${verb}. <@${record.userId}> was notified in DMs.`
					: `${getEmoji("error")} Application ${verb}, but I could not DM <@${record.userId}>. They may have removed Kaeru from their apps.`,
			});
		},
	};
}

export default [createDecisionModal("approved"), createDecisionModal("declined")];
