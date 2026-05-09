import {
	LabelBuilder,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "@minesa-org/mini-interaction";
import type {
	InteractionComponent,
	MessageComponentInteraction,
	StringSelectInteraction,
} from "@minesa-org/mini-interaction";
import { db } from "../../utils/database.ts";
import { fetchDiscord } from "../../utils/discord.ts";

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

		await db.set(`pendingTicketCreate:${user.id}`, {
			guildId,
			guildName,
			messageInteractionToken: selectInteraction.token,
			createdAt: Date.now(),
		});

		const modal = new ModalBuilder()
			.setCustomId("create:issue_modal")
			.setTitle(`Create a ticket`)
			.addComponents(
				new LabelBuilder()
					.setLabel("Describe your issue")
					.setDescription(`Minimum 25 characters for ${guildName}`.slice(0, 100))
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

		return selectInteraction.showModal(modal);
	},
};

export default createMenuHandler;
