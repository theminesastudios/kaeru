import { InteractionFlags } from "@minesa-org/mini-interaction";
import type {
	InteractionComponent,
	MessageComponentInteraction,
	StringSelectInteraction,
} from "@minesa-org/mini-interaction";
import { getEmoji } from "../../utils/index.ts";
import {
	canUseTicketStaffControls,
	formatRelativeTimestamp,
	isTicketOpen,
	patchThread,
	resolveTicketByThreadId,
	sendTicketLogMessage,
	TICKET_LOCK_REASON_SELECT_ID,
	updateTicket,
} from "../../utils/ticketControls.ts";

const reasonTextByValue: Record<string, string> = {
	"ticket-lock-reason-other": "",
	"ticket-lock-reason-off-topic": " as **off-topic**",
	"ticket-lock-reason-too-heated": " as **too heated**",
	"ticket-lock-reason-resolved": " as **resolved**",
	"ticket-lock-reason-spam": " as **spam**",
};

const ticketLockReasonSelect: InteractionComponent = {
	customId: TICKET_LOCK_REASON_SELECT_ID,

	handler: async (interaction) => {
		const selectInteraction = interaction as StringSelectInteraction &
			MessageComponentInteraction;
		const threadId = selectInteraction.channel_id;
		const actor = selectInteraction.user ?? selectInteraction.member?.user;
		const selectedValue =
			selectInteraction.values?.[0] ?? selectInteraction.data.values?.[0];
		const reason = reasonTextByValue[selectedValue || ""] ?? "";

		if (!threadId || !actor) {
			return selectInteraction.reply({
				content: `${getEmoji("error")} This menu can only be used inside a ticket thread.`,
				flags: InteractionFlags.Ephemeral,
			});
		}

		await selectInteraction.deferReply({
			flags: InteractionFlags.Ephemeral,
		});

		try {
			const { ticketData } = await resolveTicketByThreadId(threadId);

			if (!ticketData) {
				return selectInteraction.editReply({
					content: `${getEmoji("error")} This thread is not linked to a valid ticket.`,
				});
			}

			const staffCheck = await canUseTicketStaffControls(
				selectInteraction,
				ticketData,
			);
			if (!staffCheck.ok) {
				return selectInteraction.editReply({
					content: `${getEmoji("error")} ${staffCheck.message}`,
				});
			}

			if (!isTicketOpen(ticketData)) {
				return selectInteraction.editReply({
					content: `${getEmoji("error")} Closed tickets cannot be locked. Reopen the ticket first.`,
				});
			}

			await patchThread(threadId, { locked: true });
			await updateTicket(ticketData, { locked: true, lockedAt: Date.now() });

			await sendTicketLogMessage({
				threadId,
				emojiPath: "ticket.bubble.lock",
				content:
					`-# **<@!${actor.id}>** has __locked__ the thread` +
					`${reason} and limited conversation to staff ${formatRelativeTimestamp()}`,
			});

			return selectInteraction.editReply({
				content: `${getEmoji("ticket.bubble.lock")} Locked this ticket.`,
			});
		} catch (error) {
			console.error("Error locking ticket:", error);
			return selectInteraction.editReply({
				content: `${getEmoji("error")} Failed to lock this ticket. Check my Manage Threads permission.`,
			});
		}
	},
};

export default ticketLockReasonSelect;
