import { InteractionFlags } from "@minesa-org/mini-interaction";
import type {
	ButtonInteraction,
	InteractionComponent,
	MessageComponentInteraction,
} from "@minesa-org/mini-interaction";
import { buildAuthorizationContainer } from "../../utils/createTicketFlow.ts";
import { getEmoji } from "../../utils/index.ts";
import { getInteractionUser } from "../../utils/ticketControls.ts";
import {
	APPLICATION_SLOTS,
	applicationApplyButtonId,
	buildApplicationModal,
	getActiveQuestions,
	getApplicationConfig,
	hasPendingApplication,
	isUserAuthorized,
} from "../../utils/application.ts";

function createApplyButton(slot: number): InteractionComponent {
	return {
		customId: applicationApplyButtonId(slot),

		handler: async (interaction) => {
			const buttonInteraction = interaction as ButtonInteraction & MessageComponentInteraction;
			const guildId = buttonInteraction.guild_id;
			const user = getInteractionUser(buttonInteraction);

			if (!guildId || !user) return;

			// A modal has to be the first response, so every check runs before
			// anything is deferred and they all run in parallel to stay well
			// inside the auto-defer window.
			const [config, authorized, pending] = await Promise.all([
				getApplicationConfig(guildId),
				isUserAuthorized(user.id),
				hasPendingApplication(guildId, user.id, slot),
			]);

			const button = config?.buttons[slot - 1];

			if (!config?.reviewChannelId || !button || getActiveQuestions(button).length === 0) {
				return buttonInteraction.reply({
					content: `${getEmoji("error")} This application is no longer available.`,
					flags: InteractionFlags.Ephemeral,
				});
			}

			if (!authorized) {
				return buttonInteraction.reply({
					components: [buildAuthorizationContainer(false).toJSON()],
					flags: [InteractionFlags.Ephemeral, InteractionFlags.IsComponentsV2],
				});
			}

			if (pending) {
				return buttonInteraction.reply({
					content: `${getEmoji("timer")} Your **${button.label}** application is still being reviewed. You will get a DM once staff decide.`,
					flags: InteractionFlags.Ephemeral,
				});
			}

			return buttonInteraction.showModal(buildApplicationModal(slot, button));
		},
	};
}

export default APPLICATION_SLOTS.map(createApplyButton);
