import { InteractionFlags } from "@minesa-org/mini-interaction";
import type { InteractionModal } from "@minesa-org/mini-interaction";
import { getEmoji } from "../../utils/index.ts";
import {
	APPLICATION_SETUP_MODAL_ID,
	createEmptyApplicationConfig,
	getApplicationConfig,
	getPublishableButtons,
	saveApplicationConfig,
} from "../../utils/application.ts";

const applicationSetupModal: InteractionModal = {
	customId: APPLICATION_SETUP_MODAL_ID,

	handler: async (interaction) => {
		const guildId = interaction.guild_id;
		if (!guildId) return;

		await interaction.deferReply({ flags: InteractionFlags.Ephemeral });

		const title = interaction.getTextFieldValue("title")?.trim() || "Staff Applications";
		const description = interaction.getTextFieldValue("description")?.trim() ?? "";
		const panelChannelId = interaction.getSelectMenuValues("panel-channel")?.[0] ?? null;
		const reviewChannelId = interaction.getSelectMenuValues("review-channel")?.[0] ?? null;
		const reviewerRoleId = interaction.getSelectMenuValues("reviewer-role")?.[0] ?? null;

		if (!panelChannelId || !reviewChannelId) {
			return interaction.editReply({
				content: `${getEmoji("error")} Pick both a panel channel and a review channel.`,
			});
		}

		const config = (await getApplicationConfig(guildId)) ?? createEmptyApplicationConfig(guildId);
		config.title = title;
		config.description = description;
		config.panelChannelId = panelChannelId;
		config.reviewChannelId = reviewChannelId;
		config.reviewerRoleId = reviewerRoleId;

		await saveApplicationConfig(config);

		const nextStep =
			getPublishableButtons(config).length > 0
				? "Run `/application publish` to send or refresh the panel."
				: "Next, add buttons with `/application button` and questions with `/application question`, then run `/application publish`.";

		return interaction.editReply({
			content:
				`${getEmoji("seal")} Applications saved. Panel: <#${panelChannelId}> • Reviews: <#${reviewChannelId}>` +
				(reviewerRoleId ? ` • Reviewers: <@&${reviewerRoleId}>` : "") +
				`\n${nextStep}`,
		});
	},
};

export default applicationSetupModal;
