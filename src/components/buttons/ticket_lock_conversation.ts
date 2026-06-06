import {
	ContainerBuilder,
	InteractionFlags,
	TextDisplayBuilder,
} from "@minesa-org/mini-interaction";
import type {
	ButtonInteraction,
	InteractionComponent,
	MessageComponentInteraction,
} from "@minesa-org/mini-interaction";
import { getEmoji } from "../../utils/index.ts";
import {
	buildTicketLockReasonRow,
	canUseTicketStaffControls,
	resolveTicketByThreadId,
	TICKET_LOCK_BUTTON_ID,
} from "../../utils/ticketControls.ts";

const ticketLockConversationButton: InteractionComponent = {
	customId: TICKET_LOCK_BUTTON_ID,

	handler: async (interaction) => {
		const buttonInteraction = interaction as ButtonInteraction &
			MessageComponentInteraction;
		const threadId = buttonInteraction.channel_id;

		if (!threadId) {
			return buttonInteraction.reply({
				content: `${getEmoji("error")} This button can only be used inside a ticket thread.`,
				flags: InteractionFlags.Ephemeral,
			});
		}

		const { ticketData } = await resolveTicketByThreadId(threadId);
		if (!ticketData) {
			return buttonInteraction.reply({
				content: `${getEmoji("error")} This thread is not linked to a valid ticket.`,
				flags: InteractionFlags.Ephemeral,
			});
		}

		const staffCheck = await canUseTicketStaffControls(
			buttonInteraction,
			ticketData,
		);
		if (!staffCheck.ok) {
			return buttonInteraction.reply({
				content: `${getEmoji("error")} ${staffCheck.message}`,
				flags: InteractionFlags.Ephemeral,
			});
		}

		const container = new ContainerBuilder()
			.addComponent(
				new TextDisplayBuilder().setContent(
					`## ${getEmoji("ticket.bubble.lock")} Lock conversation`,
				),
			)
			.addComponent(
				new TextDisplayBuilder().setContent(
					[
						"Other users will not be able to continue this ticket through modmail.",
						"Staff can still reply from this ticket thread.",
						"Choose an optional public reason below.",
					].join("\n"),
				),
			);

		return buttonInteraction.reply({
			components: [container, buildTicketLockReasonRow()],
			flags: [InteractionFlags.Ephemeral, InteractionFlags.IsComponentsV2],
		});
	},
};

export default ticketLockConversationButton;
