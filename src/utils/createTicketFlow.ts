import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	InteractionFlags,
	LabelBuilder,
	ModalBuilder,
	TextDisplayBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "@minesa-org/mini-interaction";
import type { MessageActionRowComponent } from "@minesa-org/mini-interaction";
import { db } from "./database.ts";
import { fetchDiscord } from "./discord.ts";
import { getEmoji } from "./emojis.ts";

type DiscordGuild = {
	id: string;
	name: string;
};

export async function getMutualGuildsForUser(userId: string) {
	const userData = await db.get(userId).catch(() => null);

	if (!userData?.accessToken) {
		return {
			ok: false,
			reauthorize: false,
			userData,
			guilds: [] as DiscordGuild[],
			selectedGuild: null,
		};
	}

	try {
		const userGuilds = await fetchDiscord(
			"/users/@me/guilds",
			userData.accessToken as string,
			false,
			"GET",
			null,
			5000,
		);
		const botGuilds = await fetchDiscord(
			"/users/@me/guilds",
			process.env.DISCORD_BOT_TOKEN!,
			true,
			"GET",
			null,
			5000,
		);
		const mutualGuilds = userGuilds.filter((userGuild: DiscordGuild) =>
			botGuilds.some((botGuild: DiscordGuild) => botGuild.id === userGuild.id),
		);

		return {
			ok: true,
			reauthorize: false,
			userData,
			guilds: mutualGuilds as DiscordGuild[],
		};
	} catch (error: any) {
		if (error.message?.includes("401")) {
			return {
				ok: false,
				reauthorize: true,
				userData,
				guilds: [] as DiscordGuild[],
				selectedGuild: null,
			};
		}

		throw error;
	}
}

export async function getCreateServerAutocompleteChoices(
	userId: string,
	query: string,
) {
	const result = await getMutualGuildsForUser(userId).catch(() => null);
	if (!result?.ok) {
		return [];
	}

	const normalizedQuery = query.trim().toLowerCase();
	return result.guilds
		.filter((guild) => guild.name.toLowerCase().includes(normalizedQuery))
		.slice(0, 25)
		.map((guild) => ({
			name: guild.name.slice(0, 100),
			value: guild.id,
		}));
}

export async function resolveCreateGuildSelection(userId: string, guildId: string) {
	const result = await getMutualGuildsForUser(userId);
	if (!result.ok) {
		return result;
	}

	const guild = result.guilds.find((mutualGuild) => mutualGuild.id === guildId);
	return {
		...result,
		selectedGuild: guild ?? null,
	};
}

export async function storePendingTicketCreate({
	userId,
	guildId,
	guildName,
	messageInteractionToken,
}: {
	userId: string;
	guildId: string;
	guildName: string;
	messageInteractionToken?: string;
}) {
	await db.set(`pendingTicketCreate:${userId}`, {
		guildId,
		guildName,
		...(messageInteractionToken ? { messageInteractionToken } : {}),
		createdAt: Date.now(),
	});
}

export function buildCreateIssueModal(guildName: string) {
	return new ModalBuilder()
		.setCustomId("create:issue_modal")
		.setTitle("Create a ticket")
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
}

export function buildAuthorizationContainer(reauthorize: boolean) {
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
