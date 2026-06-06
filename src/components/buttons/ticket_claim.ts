import { InteractionFlags } from "@minesa-org/mini-interaction";
import type {
	ButtonInteraction,
	InteractionComponent,
	MessageComponentInteraction,
} from "@minesa-org/mini-interaction";
import { getEmoji } from "../../utils/index.ts";
import {
	canUseTicketStaffControls,
	claimTicketForStaff,
	formatRelativeTimestamp,
	getInteractionUser,
	isTicketOpen,
	resolveTicketByThreadId,
	sendTicketLogMessage,
	TICKET_CLAIM_BUTTON_ID,
} from "../../utils/ticketControls.ts";

const ticketClaimButton: InteractionComponent = {
	customId: TICKET_CLAIM_BUTTON_ID,

	handler: async (interaction) => {
		const buttonInteraction = interaction as ButtonInteraction &
			MessageComponentInteraction;
		const threadId = buttonInteraction.channel_id;
		const actor = getInteractionUser(buttonInteraction);

		await buttonInteraction.deferReply({
			flags: [InteractionFlags.Ephemeral, InteractionFlags.IsComponentsV2],
		});

		if (!threadId || !actor) {
			return buttonInteraction.editReply({
				content: `${getEmoji("error")} This button can only be used inside a ticket thread.`,
			});
		}

		try {
			const { ticketData } = await resolveTicketByThreadId(threadId);

			if (!ticketData) {
				return buttonInteraction.editReply({
					content: `${getEmoji("error")} This thread is not linked to a valid ticket.`,
				});
			}

			const staffCheck = await canUseTicketStaffControls(
				buttonInteraction,
				ticketData,
			);
			if (!staffCheck.ok) {
				return buttonInteraction.editReply({
					content: `${getEmoji("error")} ${staffCheck.message}`,
				});
			}

			if (!isTicketOpen(ticketData)) {
				return buttonInteraction.editReply({
					content: `${getEmoji("error")} Reopen this ticket before claiming it.`,
				});
			}

			const previousStaffId =
				typeof ticketData.claimedById === "string" ? ticketData.claimedById : null;

			await claimTicketForStaff({
				ticketData,
				threadId,
				claimant: {
					id: actor.id,
					username: actor.username,
				},
			});

			await sendTicketLogMessage({
				threadId,
				emojiPath: "people",
				content:
					`-# **<@!${actor.id}>** has __claimed__ this ticket ${formatRelativeTimestamp()}` +
					(previousStaffId && previousStaffId !== actor.id
						? ` and replaced <@!${previousStaffId}>`
						: ""),
			});

			return buttonInteraction.editReply({
				content: `${getEmoji("people")} You claimed this ticket.`,
			});
		} catch (error) {
			console.error("Error claiming ticket:", error);
			return buttonInteraction.editReply({
				content: `${getEmoji("error")} Failed to claim this ticket. Check my private thread permissions.`,
			});
		}
	},
};

export default ticketClaimButton;
