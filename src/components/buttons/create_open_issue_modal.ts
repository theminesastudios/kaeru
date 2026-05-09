import {
	LabelBuilder,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "@minesa-org/mini-interaction";
import type {
	ButtonInteraction,
	InteractionComponent,
	MessageComponentInteraction,
} from "@minesa-org/mini-interaction";
import { db } from "../../utils/database.ts";

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

		const modal = new ModalBuilder()
			.setCustomId("create:issue_modal")
			.setTitle("Create a ticket")
			.addComponents(
				new LabelBuilder()
					.setLabel("Describe your issue")
					.setDescription("Minimum 25 characters")
					.setComponent(
						new TextInputBuilder()
							.setCustomId("issue_description")
							.setPlaceholder("Explain what happened, what you expected, and any relevant details.")
							.setStyle(TextInputStyle.Paragraph)
							.setMinLength(25)
							.setMaxLength(4000)
							.setRequired(true),
					),
			);

		return buttonInteraction.showModal(modal);
	},
};

export default createOpenIssueModalButton;
