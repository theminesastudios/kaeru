import { InteractionFlags } from "@minesa-org/mini-interaction";
import type {
	ChannelSelectInteraction,
	InteractionComponent,
	MessageComponentInteraction,
} from "@minesa-org/mini-interaction";
import { fetchGuild } from "../../utils/punishment.ts";
import {
	PUNISHMENT_RULES_CHANNEL_SELECT_ID,
	runSetup,
} from "../../commands/punishment.ts";
import { getEmoji } from "../../utils/index.ts";

const punishmentRulesChannelSelect: InteractionComponent = {
	customId: PUNISHMENT_RULES_CHANNEL_SELECT_ID,

	handler: async (interaction) => {
		const selectInteraction = interaction as ChannelSelectInteraction &
			MessageComponentInteraction;
		const guildId = selectInteraction.guild_id;
		const moderatorId =
			selectInteraction.user?.id ?? selectInteraction.member?.user?.id;
		const channelId = selectInteraction.getChannels?.()?.[0]?.id ?? selectInteraction.values?.[0];

		if (!guildId || !moderatorId || !channelId) {
			return selectInteraction.reply({
				content: `${getEmoji("error")} Could not resolve the selected channel.`,
				flags: InteractionFlags.Ephemeral,
			});
		}

		const guild = await fetchGuild(guildId).catch(() => null);
		const guildName = typeof guild?.name === "string" ? guild.name : "this server";

		// Reuses the exact same setup flow as `/punishment setup`, so both entry
		// points produce identical results.
		return runSetup({
			interaction: selectInteraction,
			guildId,
			guildName,
			channelId,
			moderatorId,
		});
	},
};

export default punishmentRulesChannelSelect;