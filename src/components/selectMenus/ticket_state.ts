import {
	InteractionFlags,
	LabelBuilder,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "@minesa-org/mini-interaction";
import type {
	InteractionComponent,
	MessageComponentInteraction,
	StringSelectInteraction,
} from "@minesa-org/mini-interaction";
import { getEmoji } from "../../utils/index.ts";
import {
	canUseTicketStaffControls,
	closeTicketWithStatus,
	formatRelativeTimestamp,
	isTicketOpen,
	notifyTicketUser,
	patchThread,
	resolveTicketByThreadId,
	restoreActiveTicket,
	sendTicketLogMessage,
	TICKET_CLOSE_MODAL_ID,
	TICKET_STATUS_CLOSE_COMMENT,
	TICKET_STATUS_DONE,
	TICKET_STATUS_NOT_PLANNED,
	TICKET_STATUS_REOPEN,
	TICKET_STATUS_SELECT_ID,
	updateTicket,
} from "../../utils/ticketControls.ts";

const ticketStateSelect: InteractionComponent = {
	customId: TICKET_STATUS_SELECT_ID,

	handler: async (interaction) => {
		const selectInteraction = interaction as StringSelectInteraction &
			MessageComponentInteraction;
		const actor = selectInteraction.user ?? selectInteraction.member?.user;
		const selectedValue =
			selectInteraction.values?.[0] ?? selectInteraction.data.values?.[0];

		if (selectedValue === TICKET_STATUS_CLOSE_COMMENT) {
			const modal = new ModalBuilder()
				.setCustomId(TICKET_CLOSE_MODAL_ID)
				.setTitle("Close Ticket")
				.addComponents(
					new LabelBuilder()
						.setLabel("Reason for closing")
						.setDescription("This comment is posted in the ticket thread")
						.setComponent(
							new TextInputBuilder()
								.setCustomId("close-reason")
								.setStyle(TextInputStyle.Paragraph)
								.setMaxLength(2000)
								.setRequired(true),
						),
				);

			return selectInteraction.showModal(modal);
		}

		await selectInteraction.deferReply({
			flags: [InteractionFlags.Ephemeral, InteractionFlags.IsComponentsV2],
		});

		const threadId = selectInteraction.channel_id;
		if (!threadId || !actor) {
			return selectInteraction.editReply({
				content: `${getEmoji("error")} This menu can only be used inside a ticket thread.`,
			});
		}

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

			switch (selectedValue) {
				case TICKET_STATUS_DONE:
					await closeTicketWithStatus({
						ticketData,
						threadId,
						userId: actor.id,
						status: "closed_completed",
						logEmoji: "ticket.bubble.done",
						logText: "__closed__ this as completed",
						lockThread: true,
						userMessage:
							`## ${getEmoji("ticket.bubble.done")} Your ticket has been completed\n` +
							"Staff marked your ticket as resolved. You can create a new ticket if you need more help.",
					});

					return selectInteraction.editReply({
						content: `${getEmoji("ticket.bubble.done")} Closed this ticket as completed.`,
					});

				case TICKET_STATUS_NOT_PLANNED:
					await closeTicketWithStatus({
						ticketData,
						threadId,
						userId: actor.id,
						status: "closed_not_planned",
						logEmoji: "ticket.bubble.stale",
						logText: "__closed__ this as not planned",
						lockThread: false,
						userMessage:
							`## ${getEmoji("ticket.bubble.stale")} Your ticket was closed as not planned\n` +
							"Staff closed this ticket without planned follow-up. You can create a new ticket if anything changes.",
					});

					return selectInteraction.editReply({
						content: `${getEmoji("ticket.bubble.stale")} Closed this ticket as not planned.`,
					});

				case TICKET_STATUS_REOPEN: {
					if (isTicketOpen(ticketData) && !ticketData.locked) {
						return selectInteraction.editReply({
							content: `${getEmoji("ticket.bubble.reopen")} This ticket is already open.`,
						});
					}

					const restoreResult = await restoreActiveTicket(ticketData);
					if (!restoreResult.ok) {
						return selectInteraction.editReply({
							content: `${getEmoji("error")} ${restoreResult.message}`,
						});
					}

					await patchThread(threadId, { archived: false, locked: false });
					await updateTicket(ticketData, {
						status: "open",
						locked: false,
						reopenedAt: Date.now(),
						closedAt: null,
						closedBy: null,
						closeReason: null,
					});

					await sendTicketLogMessage({
						threadId,
						emojiPath: "ticket.bubble.reopen",
						content: `-# **<@!${actor.id}>** has __re-opened__ this ticket ${formatRelativeTimestamp()}`,
					});

					await notifyTicketUser(
						ticketData,
						`## ${getEmoji("ticket.bubble.reopen")} Your ticket has been reopened\nYou can continue with </send:1477601535692247294> in DMs.`,
					);

					return selectInteraction.editReply({
						content: `${getEmoji("ticket.bubble.reopen")} Reopened this ticket.`,
					});
				}

				default:
					return selectInteraction.editReply({
						content: `${getEmoji("error")} Unknown ticket action.`,
					});
			}
		} catch (error) {
			console.error("Error changing ticket state:", error);
			return selectInteraction.editReply({
				content: `${getEmoji("error")} Failed to update this ticket. Check my thread permissions.`,
			});
		}
	},
};

export default ticketStateSelect;
