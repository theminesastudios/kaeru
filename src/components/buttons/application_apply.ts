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
	buildApplicationForm,
	buildFormNotice,
	createApplicationDraft,
	getActivePages,
	getApplicationConfig,
	getApplicationDraft,
	hasPendingApplication,
	isUserAuthorized,
	saveApplicationDraft,
} from "../../utils/application.ts";

function createApplyButton(slot: number): InteractionComponent {
	return {
		customId: applicationApplyButtonId(slot),

		handler: async (interaction) => {
			const buttonInteraction = interaction as ButtonInteraction & MessageComponentInteraction;
			const guildId = buttonInteraction.guild_id;
			const user = getInteractionUser(buttonInteraction);

			if (!guildId || !user) return;

			// This button sits on the public panel, so it must be acknowledged as a
			// private reply before anything slow runs. If the library's timed
			// auto-defer fires first it defers as a message *update*, and the
			// answer below then overwrites the panel message itself for everyone.
			// The components flag has to be set here; it cannot be added on the edit.
			buttonInteraction.deferReply({ flags: [InteractionFlags.Ephemeral, InteractionFlags.IsComponentsV2] });

			const [config, authorized, pending, existingDraft] = await Promise.all([
				getApplicationConfig(guildId),
				isUserAuthorized(user.id),
				hasPendingApplication(guildId, user.id, slot),
				getApplicationDraft(guildId, user.id),
			]);

			const button = config?.buttons[slot - 1];

			if (!config?.reviewChannelId || !button || getActivePages(button).length === 0) {
				return buttonInteraction.editReply({
					components: buildFormNotice(`${getEmoji("error")} This application is no longer available.`),
				});
			}

			if (!authorized) {
				return buttonInteraction.editReply({
					components: [buildAuthorizationContainer(false).toJSON()],
				});
			}

			if (pending) {
				return buttonInteraction.editReply({
					components: buildFormNotice(
						`${getEmoji("timer")} Your **${button.label}** application is still being reviewed. You will get a DM once staff decide.`,
					),
				});
			}

			// Coming back to the same position resumes the answers given so far;
			// picking another position starts over.
			const draft = existingDraft?.slot === slot ? existingDraft : createApplicationDraft(slot);
			await saveApplicationDraft(guildId, user.id, draft);

			return buttonInteraction.editReply({
				components: buildApplicationForm(button, draft),
			});
		},
	};
}

export default APPLICATION_SLOTS.map(createApplyButton);
