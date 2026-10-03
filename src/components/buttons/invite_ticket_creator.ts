import { InteractionFlags } from "@minesa-org/mini-interaction";
import type {
	ButtonInteraction,
	InteractionComponent,
	MessageComponentInteraction,
} from "@minesa-org/mini-interaction";
import { db } from "../../utils/database.ts";
import { getEmoji } from "../../utils/index.ts";
import { addThreadMember } from "../../utils/ticketControls.ts";

const inviteTicketCreatorButton: InteractionComponent = {
	customId: "ticket:invite_creator",

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

		await buttonInteraction.deferReply({
			flags: InteractionFlags.Ephemeral,
		});

		try {
			const threadData = await db.get(`thread:${threadId}`);
			if (!threadData?.ticketId) {
				return buttonInteraction.editReply({
					content: `${getEmoji("error")} This thread is not linked to a valid ticket.`,
				});
			}

			const ticketData = await db.get(`ticket:${threadData.ticketId}`);
			const userId =
				typeof ticketData?.userId === "string" ? ticketData.userId : null;

			if (!userId) {
				return buttonInteraction.editReply({
					content: `${getEmoji("error")} Could not resolve the ticket creator for this thread.`,
				});
			}

			await addThreadMember(threadId, userId);

			return buttonInteraction.editReply({
				content: `${getEmoji("seal")} Invited <@${userId}> to this ticket thread.`,
			});
		} catch (error) {
			console.error("Error inviting ticket creator to thread:", error);
			return buttonInteraction.editReply({
				content:
					`${getEmoji("error")} Failed to invite the ticket creator. Check that the user is still in the server and that I can manage private thread members.`,
			});
		}
	},
};

export default inviteTicketCreatorButton;
