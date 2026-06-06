import type {
	ButtonInteraction,
	InteractionComponent,
	MessageComponentInteraction,
} from "@minesa-org/mini-interaction";
import { db } from "../../utils/database.ts";
import { buildCreateIssueModal } from "../../utils/createTicketFlow.ts";

const createOpenIssueModalButton: InteractionComponent = {
	customId: "create:open_issue_modal",

	handler: async (interaction) => {
		const buttonInteraction = interaction as ButtonInteraction &
			MessageComponentInteraction;
		const user = buttonInteraction.user ?? buttonInteraction.member?.user;

		if (!user) {
			return buttonInteraction.reply({
				content: "Could not resolve user.",
			});
		}

		const pendingTicket = await db.get(`pendingTicketCreate:${user.id}`);
		await db.set(`pendingTicketCreate:${user.id}`, {
			...(pendingTicket || {}),
			messageInteractionToken: buttonInteraction.token,
			updatedAt: Date.now(),
		});

		return buttonInteraction.showModal(
			buildCreateIssueModal(
				typeof pendingTicket?.guildName === "string"
					? pendingTicket.guildName
					: "selected server",
			),
		);
	},
};

export default createOpenIssueModalButton;
