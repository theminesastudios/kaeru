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

			// A claimed ticket belongs to its claimant. Without this guard any
			// staff member can take it back at any time, and because claiming
			// removes the other person from the thread, two staff end up
			// stealing the same ticket back and forth.
			if (previousStaffId && previousStaffId !== actor.id) {
				return buttonInteraction.editReply({
					content: `${getEmoji("error")} <@!${previousStaffId}> already claimed this ticket.`,
				});
			}

			if (previousStaffId === actor.id) {
				return buttonInteraction.editReply({
					content: `${getEmoji("people")} You already claimed this ticket.`,
				});
			}

			const { removedMemberIds, failedMemberIds } = await claimTicketForStaff({
				ticketData,
				threadId,
				claimant: {
					id: actor.id,
					username: actor.username,
				},
			});

			// Report the cleanup in the ticket itself. A failed removal used to
			// be a console-only warning, so a claim that quietly left people in
			// the thread looked identical to a working one.
			const removedNote =
				removedMemberIds.length > 0
					? ` • removed ${removedMemberIds.length} other member${
							removedMemberIds.length === 1 ? "" : "s"
						}`
					: "";
			const failedNote =
				failedMemberIds.length > 0
					? ` • ${getEmoji("error")} could not remove ${failedMemberIds
							.map((userId) => `<@${userId}>`)
							.join(", ")} — check my **Manage Threads** permission`
					: "";

			await sendTicketLogMessage({
				threadId,
				emojiPath: "people",
				content:
					`-# **<@!${actor.id}>** has __claimed__ this ticket ${formatRelativeTimestamp()}` +
					removedNote +
					failedNote,
			});

			return buttonInteraction.editReply({
				content:
					`${getEmoji("people")} You claimed this ticket.` +
					(failedNote ? `\n${failedNote.replace(" • ", "")}` : ""),
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
