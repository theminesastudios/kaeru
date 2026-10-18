import {
	InteractionFlags,
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
import { getEmoji } from "../../utils/index.ts";
import {
	APPLICATION_APPROVE_BUTTON_ID,
	APPLICATION_APPROVE_MODAL_ID,
	APPLICATION_DECLINE_BUTTON_ID,
	APPLICATION_DECLINE_MODAL_ID,
	canReviewApplications,
	getApplicationConfig,
} from "../../utils/application.ts";

function createReviewButton(decision: "approve" | "decline"): InteractionComponent {
	const approve = decision === "approve";

	return {
		customId: approve ? APPLICATION_APPROVE_BUTTON_ID : APPLICATION_DECLINE_BUTTON_ID,

		handler: async (interaction) => {
			const buttonInteraction = interaction as ButtonInteraction & MessageComponentInteraction;
			const guildId = buttonInteraction.guild_id;
			if (!guildId) return;

			const config = await getApplicationConfig(guildId);

			if (!canReviewApplications(buttonInteraction.member, config)) {
				return buttonInteraction.reply({
					content: `${getEmoji("error")} Only members with **Manage Server** or the reviewer role can review applications.`,
					flags: InteractionFlags.Ephemeral,
				});
			}

			// The note is optional, so a reviewer can still approve or decline
			// with a single extra click.
			const modal = new ModalBuilder()
				.setCustomId(approve ? APPLICATION_APPROVE_MODAL_ID : APPLICATION_DECLINE_MODAL_ID)
				.setTitle(approve ? "Approve Application" : "Decline Application")
				.addComponents(
					new LabelBuilder()
						.setLabel("Message to the applicant")
						.setDescription("Optional. Sent to them in DMs together with the decision")
						.setComponent(
							new TextInputBuilder()
								.setCustomId("note")
								.setStyle(TextInputStyle.Paragraph)
								.setMaxLength(1500)
								.setRequired(false)
								.setPlaceholder(
									approve
										? "Welcome to the team! Here is what happens next…"
										: "Thanks for applying. Unfortunately…",
								),
						),
				);

			return buttonInteraction.showModal(modal);
		},
	};
}

export default [createReviewButton("approve"), createReviewButton("decline")];
