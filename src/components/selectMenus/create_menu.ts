import type {
	InteractionComponent,
	MessageComponentInteraction,
	StringSelectInteraction,
} from "@minesa-org/mini-interaction";
import { db } from "../../utils/database.ts";
import { fetchDiscord } from "../../utils/discord.ts";
import {
	buildCreateIssueModal,
	storePendingTicketCreate,
} from "../../utils/createTicketFlow.ts";

const createMenuHandler: InteractionComponent = {
	customId: "create:select_server",

	handler: async (interaction) => {
		const selectInteraction = interaction as StringSelectInteraction &
			MessageComponentInteraction;
		const guildId = selectInteraction.data.values[0];
		const user = selectInteraction.user ?? selectInteraction.member?.user;

		if (!guildId || !user) {
			return selectInteraction.update({
				content: "Could not resolve user or selected server.",
			});
		}

		let guildName = "Selected server";
		try {
			const guildData = await db.get(`guild:${guildId}`);
			if (typeof guildData?.guildName === "string") {
				guildName = guildData.guildName;
			} else {
				const guild = await fetchDiscord(
					`/guilds/${guildId}`,
					process.env.DISCORD_BOT_TOKEN!,
					true,
					"GET",
					null,
					3000,
				);
				if (typeof guild?.name === "string" && guild.name.length > 0) {
					guildName = guild.name;
				}
			}
		} catch (error) {
			console.warn(`[Kaeru] Could not resolve guild name for ${guildId}:`, error);
		}

		await storePendingTicketCreate({
			userId: user.id,
			guildId,
			guildName,
			messageInteractionToken: selectInteraction.token,
		});

		return selectInteraction.showModal(buildCreateIssueModal(guildName));
	},
};

export default createMenuHandler;
