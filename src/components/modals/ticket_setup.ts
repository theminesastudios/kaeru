import {
	InteractionFlags,
	MessageFlags,
	ContainerBuilder,
	TextDisplayBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	GalleryBuilder,
	GalleryItemBuilder,
} from "@minesa-org/mini-interaction";
import type { InteractionModal, MessageActionRowComponent } from "@minesa-org/mini-interaction";
import { db } from "../../utils/database.ts";
import { getEmoji } from "../../utils/index.ts";
import { getDiscordRestClient } from "../../utils/rest.ts";

const ticketSetupModal: InteractionModal = {
	customId: "ticket-setup-modal",

	handler: async (interaction) => {
		const guildId = interaction.guild_id;
		if (!guildId) return;

		await interaction.deferReply({ flags: InteractionFlags.Ephemeral });

		const description = interaction.getTextFieldValue("description");
		const staffRoleId = interaction.getSelectMenuValues("staff-role")?.[0];
		const staffPingMode =
			interaction.getSelectMenuValues("staff-ping-mode")?.[0] === "random"
				? "random"
				: "role";
		const bannerUrl = interaction.getAttachment("banner_url")?.url;
		const channelId = interaction.getSelectMenuValues("channel")?.[0];

		if (!channelId) {
			return interaction.editReply({
				content: `${getEmoji("error")} You must select a channel for the ticket system.`,
			});
		}

		try {
			// Update database
			const existingData = (await db.get(`guild:${guildId}`)) || {};
			const updatedData = {
				...existingData,
				guildId,
				description:
					description ||
					existingData.description ||
					"Create a ticket to get support from our staff.",
				pingRoleId: staffRoleId || existingData.pingRoleId,
				staffPingMode,
				bannerUrl: bannerUrl || existingData.bannerUrl,
				ticketChannelId: channelId,
				status: "active",
			};

			// Remove internal fields if any
			delete (updatedData as any).createdAt;
			delete (updatedData as any).updatedAt;

			await db.set(`guild:${guildId}`, updatedData);

			// Prepare ticket creation message
			const oauthUrl = `https://discord.com/oauth2/authorize?client_id=${
				process.env.DISCORD_APPLICATION_ID
			}&response_type=code&redirect_uri=${encodeURIComponent(
				process.env.DISCORD_REDIRECT_URI || "",
			)}&scope=applications.commands+identify+guilds+role_connections.write&integration_type=1`;

			const authButton = new ActionRowBuilder<MessageActionRowComponent>().addComponents(
				new ButtonBuilder()
					.setLabel("Authorize App")
					.setStyle(ButtonStyle.Link)
					.setURL(oauthUrl),
			);

			// Create Ticket button removed as per user request to use DM flow

			const container = new ContainerBuilder().addComponent(
				new TextDisplayBuilder().setContent(
					`## ${getEmoji("sharedwithu")} Support Center\n${updatedData.description}\n\n- To start a conversation, please **Authorize the App** and then **direct message (DM)** me!`,
				),
			);

			if (updatedData.bannerUrl) {
				container.addComponent(
					new GalleryBuilder().addItem(
						new GalleryItemBuilder().setMedia({ url: updatedData.bannerUrl as string }),
					),
				);
			}

			const rest = getDiscordRestClient();

			await rest.send({
				channelId,
				components: [container, authButton],
				flags: MessageFlags.IsComponentsV2,
			});

			return interaction.editReply({
				content: `${getEmoji("seal")} Ticket system has been configured and the creation message was sent to <#${channelId}>.`,
			});
		} catch (error) {
			console.error("Error in ticket setup modal handler:", error);
			return interaction.editReply({
				content: `${getEmoji("error")} Failed to complete setup. Please check my permissions in <#${channelId}>.`,
			});
		}
	},
};

export default ticketSetupModal;
