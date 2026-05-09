import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	InteractionFlags,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	TextDisplayBuilder,
} from "@minesa-org/mini-interaction";
import type { MessageActionRowComponent } from "@minesa-org/mini-interaction";
import { db } from "./database.ts";
import { fetchDiscord } from "./discord.ts";
import { getEmoji } from "./emojis.ts";

export async function showCreateServerSelect(interaction: any, user: any) {
	let userTicketData;
	try {
		userTicketData = await db.get(`user:${user.id}`);
	} catch (dbError) {
		console.error("Database error getting user ticket data:", dbError);
		userTicketData = null;
	}

	if (userTicketData?.activeTicketId) {
		let existingTicket;
		try {
			existingTicket = await db.get(`ticket:${userTicketData.activeTicketId}`);
		} catch (dbError) {
			console.error("Database error getting ticket data:", dbError);
			existingTicket = null;
		}

		if (existingTicket?.status === "open") {
			const container = new ContainerBuilder()
				.addComponent(
					new TextDisplayBuilder().setContent(
						`## ${getEmoji("error")} You already have an open ticket!`,
					),
				)
				.addComponent(
					new TextDisplayBuilder().setContent(
						"Please use </send:1477601535692247294> in DMs to communicate with staff.",
					),
				);

			return interaction.editReply({
				components: [container],
			});
		}
	}

	let userData;
	try {
		userData = await db.get(user.id);
	} catch (dbError) {
		console.error("Database error getting user data:", dbError);
		userData = null;
	}

	if (!userData?.accessToken) {
		return interaction.editReply({
			components: [buildAuthorizationContainer(false)],
		});
	}

	try {
		let userGuilds;
		try {
			userGuilds = await fetchDiscord(
				"/users/@me/guilds",
				userData.accessToken as string,
				false,
				"GET",
				null,
				5000,
			);
		} catch (userError: any) {
			if (userError.message?.includes("401")) {
				return interaction.editReply({
					components: [buildAuthorizationContainer(true)],
				});
			}

			throw userError;
		}

		const botGuilds = await fetchDiscord(
			"/users/@me/guilds",
			process.env.DISCORD_BOT_TOKEN!,
			true,
			"GET",
			null,
			5000,
		);

		const mutualGuilds = userGuilds.filter((ug: any) =>
			botGuilds.some((bg: any) => bg.id === ug.id),
		);

		if (mutualGuilds.length === 0) {
			const container = new ContainerBuilder()
				.addComponent(
					new TextDisplayBuilder().setContent(
						`## ${getEmoji("error")} No mutual servers found`,
					),
				)
				.addComponent(
					new TextDisplayBuilder().setContent(
						"Make sure the bot is invited to the servers you are in.",
					),
				);

			return interaction.editReply({
				components: [container],
			});
		}

		const menu = new ActionRowBuilder<MessageActionRowComponent>()
			.addComponents(
				new StringSelectMenuBuilder()
					.setCustomId("create:select_server")
					.setPlaceholder("Select a server to create a thread")
					.addOptions(
						...mutualGuilds
							.slice(0, 25)
							.map((guild: any) =>
								new StringSelectMenuOptionBuilder()
									.setLabel(guild.name)
									.setValue(guild.id),
							),
					),
			);

		const container = new ContainerBuilder()
			.addComponent(
				new TextDisplayBuilder().setContent(
					`## ${getEmoji("sharedwithu")} Creating a ticketmail`,
				),
			)
			.addComponent(
				new TextDisplayBuilder().setContent(
					"Please select a server where you want to open a ticketmail from the dropdown below.",
				),
			)
			.addComponent(menu);

		return interaction.editReply({
			components: [container],
		});
	} catch (error) {
		console.error("Error preparing /create server select:", error);

		const container = new ContainerBuilder()
			.addComponent(
				new TextDisplayBuilder().setContent(
					`## ${getEmoji("error")} Could not fetch your servers`,
				),
			)
			.addComponent(
				new TextDisplayBuilder().setContent(
					"An error occurred while fetching your servers. Please try again later.",
				),
			);

		return interaction.editReply({
			components: [container],
		});
	}
}

function buildAuthorizationContainer(reauthorize: boolean) {
	const oauthUrl = `https://discord.com/oauth2/authorize?client_id=${
		process.env.DISCORD_APPLICATION_ID
	}&response_type=code&redirect_uri=${encodeURIComponent(
		process.env.DISCORD_REDIRECT_URI!,
	)}&scope=applications.commands+identify+guilds+role_connections.write&integration_type=1`;

	const button = new ActionRowBuilder<MessageActionRowComponent>().addComponents(
		new ButtonBuilder()
			.setLabel("Authorize App")
			.setStyle(ButtonStyle.Link)
			.setURL(oauthUrl),
	);

	return new ContainerBuilder()
		.addComponent(
			new TextDisplayBuilder().setContent(
				`## ${getEmoji("lock_fill")} ${reauthorize ? "Re-authorization Required" : "Authorization Required"}`,
			),
		)
		.addComponent(
			new TextDisplayBuilder().setContent(
				reauthorize
					? "Your authorization has expired. Click the button below to re-authorize."
					: "You have not authorized your account with the app. Click the button below to authorize.",
			),
		)
		.addComponent(button);
}

export async function deferCreateReply(interaction: any) {
	return interaction.deferReply({
		flags: InteractionFlags.IsComponentsV2 | InteractionFlags.Ephemeral,
	});
}
