import { InteractionFlags } from "@minesa-org/mini-interaction";
import type {
	InteractionModal,
	ModalSubmitInteraction,
} from "@minesa-org/mini-interaction";
import { getEmoji } from "../../utils/index.ts";
import {
	canUseTicketStaffControls,
	closeTicketWithStatus,
	getInteractionUser,
	resolveTicketByThreadId,
	TICKET_CLOSE_MODAL_ID,
} from "../../utils/ticketControls.ts";

const ticketCloseModal: InteractionModal = {
	customId: TICKET_CLOSE_MODAL_ID,

	handler: async (interaction: ModalSubmitInteraction) => {
		const threadId = (interaction as any).channel_id;
		const user = getInteractionUser(interaction);
		const closeReason =
			interaction.getTextFieldValue("close-reason")?.trim() || "";

		await interaction.deferReply({
			flags: [InteractionFlags.Ephemeral, InteractionFlags.IsComponentsV2],
		});

		if (!threadId || !user) {
			return interaction.editReply({
				content: `${getEmoji("error")} This modal can only be used inside a ticket thread.`,
			});
		}

		try {
			const { ticketData } = await resolveTicketByThreadId(threadId);

			if (!ticketData) {
				return interaction.editReply({
					content: `${getEmoji("error")} This thread is not linked to a valid ticket.`,
				});
			}

			const staffCheck = await canUseTicketStaffControls(interaction, ticketData);
			if (!staffCheck.ok) {
				return interaction.editReply({
					content: `${getEmoji("error")} ${staffCheck.message}`,
				});
			}

			await closeTicketWithStatus({
				ticketData,
				threadId,
				userId: user.id,
				status: "closed_commented",
				logEmoji: "ticket.bubble.close",
				logText: "has __force closed__ this as completed",
				lockThread: true,
				comment: closeReason,
				userMessage:
					`## ${getEmoji("ticket.bubble.close")} Your ticket has been closed\n` +
					(closeReason
						? `Staff left this closing comment:\n>>> ${closeReason}`
						: "Staff closed this ticket."),
			});

			return interaction.editReply({
				content: `${getEmoji("ticket.bubble.close")} Closed this ticket with a comment.`,
			});
		} catch (error) {
			console.error("Error closing ticket with comment:", error);
			return interaction.editReply({
				content: `${getEmoji("error")} Failed to close this ticket. Check my thread permissions.`,
			});
		}
	},
};

export default ticketCloseModal;
