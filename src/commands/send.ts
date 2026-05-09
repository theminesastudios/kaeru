import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	CommandBuilder,
	CommandContext,
	ContainerBuilder,
	IntegrationType,
	InteractionFlags,
	MiniPermFlags,
	TextDisplayBuilder,
} from "@minesa-org/mini-interaction";
import type {
	CommandInteraction,
	InteractionCommand,
	MessageActionRowComponent,
} from "@minesa-org/mini-interaction";
import { db } from "../utils/database.ts";
import { getEmoji, getOrCreateWebhookUrl, sendAlertMessage } from "../utils/index.ts";

function buildSentMessageContainer(content: string, footer: string) {
	return new ContainerBuilder()
		.addComponent(
			new TextDisplayBuilder().setContent(`>>> ${content}`),
		)
		.addComponent(
			new TextDisplayBuilder().setContent(footer),
		);
}

const sendCommand: InteractionCommand = {
	data: new CommandBuilder()
		.setName("send")
		.setDescription("Send a message to the ticket system")
		.setDefaultMemberPermissions(MiniPermFlags.ManageThreads)
		.setContexts([CommandContext.Guild, CommandContext.Bot])
		.setIntegrationTypes([
			IntegrationType.GuildInstall,
			IntegrationType.UserInstall,
		])
		.addStringOption((option) =>
			option
				.setName("content")
				.setDescription("The message content")
				.setRequired(true),
		),

	handler: async (interaction: CommandInteraction) => {
		const { options, guild, channel } = interaction;
		const user = interaction.user ?? interaction.member?.user;

		if (!user) {
			return sendAlertMessage({
				interaction,
				content: "Could not resolve user.",
				type: "error",
			});
		}

		await interaction.deferReply({
			flags: InteractionFlags.IsComponentsV2,
		});

		const content = options.getString("content")!;

		try {
			const isDM = !interaction.guild_id;

			if (isDM) {
				let userData;
				try {
					userData = await db.get(user.id);
				} catch (dbError) {
					console.error("Database error getting user data:", dbError);
					userData = null;
				}

				if (!userData || !userData.accessToken) {
					const oauthUrl = `https://discord.com/oauth2/authorize?client_id=${
						process.env.DISCORD_APPLICATION_ID
					}&response_type=code&redirect_uri=${encodeURIComponent(
						process.env.DISCORD_REDIRECT_URI || "",
					)}&scope=applications.commands+identify+guilds+role_connections.write&integration_type=1`;

					const button = new ActionRowBuilder<MessageActionRowComponent>()
						.addComponents(
							new ButtonBuilder()
								.setLabel("Authorize App")
								.setStyle(ButtonStyle.Link)
								.setURL(oauthUrl),
						);

					const container = new ContainerBuilder()
						.addComponent(
							new TextDisplayBuilder().setContent(
								`## ${getEmoji("lock_fill")} Authorization Required`,
							),
						)
						.addComponent(
							new TextDisplayBuilder().setContent(
								"You have not authorized your account with the app. Click the button below to authorize.",
							),
						)
						.addComponent(button);

					return interaction.editReply({
						components: [container],
					});
				}

				let userTicketData;
				try {
					userTicketData = await db.get(`user:${user.id}`);
				} catch (dbError) {
					console.error("Database error getting user ticket data:", dbError);
					userTicketData = null;
				}

				if (!userTicketData || !userTicketData.activeTicketId) {
					return sendAlertMessage({
						interaction,
						content: `**You don't have an active ticket.**\n\nIf you need assistance, please use </create:1477209072800632845> in a mutual server first.\n\n-# If you are staff, please use this command inside a ticket thread.`,
						type: "error",
					});
				}

				const ticketData = await db.get(`ticket:${userTicketData.activeTicketId}`);

				if (!ticketData || ticketData.status !== "open") {
					return sendAlertMessage({
						interaction,
						content: "Your ticket is not active or doesn't exist.",
						type: "error",
					});
				}

				const guildData = await db.get(`guild:${ticketData.guildId}`);
				let webhookUrl = guildData?.webhookUrl;

				let webhookWorked = false;
				const dmToTicketFooter = `-# Message sent to ticket ${getEmoji("reply")}`;

				const sendWebhookMessage = async (url: string) => {
					return await fetch(`${url}?thread_id=${ticketData.threadId}`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							content: content,
							username: user.username,
							avatar_url: user.avatar
								? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
								: undefined,
						}),
					});
				};

				if (webhookUrl) {
					try {
						let webhookResponse = await sendWebhookMessage(webhookUrl as string);

						if (webhookResponse.status === 404) {
							// Webhook was deleted, recreate it
							const targetChannelId = (ticketData as any).channelId || (guildData as any).ticketChannelId || (guildData as any).systemChannelId;
							if (targetChannelId) {
								webhookUrl = await getOrCreateWebhookUrl(targetChannelId, process.env.DISCORD_BOT_TOKEN!);
								if (webhookUrl) {
									await db.set(`guild:${ticketData.guildId}`, { ...(guildData || {}), webhookUrl });
									webhookResponse = await sendWebhookMessage(webhookUrl as string);
								}
							}
						}

						if (webhookResponse.ok) {
							webhookWorked = true;
							return interaction.editReply({
								components: [
									buildSentMessageContainer(content, dmToTicketFooter).toJSON(),
								],
							});
						}
					} catch (webhookError) {
						console.warn("Webhook error:", webhookError);
					}
				}

				if (!webhookWorked) {
					// Fallback: try to repair webhook if it was missing or previous attempt failed
					const targetChannelId = (ticketData as any).channelId || (guildData as any).ticketChannelId || (guildData as any).systemChannelId;
					if (targetChannelId) {
						webhookUrl = await getOrCreateWebhookUrl(targetChannelId, process.env.DISCORD_BOT_TOKEN!);
						if (webhookUrl) {
							await db.set(`guild:${ticketData.guildId}`, { ...(guildData || {}), webhookUrl });
							try {
								const webhookResponse = await sendWebhookMessage(webhookUrl as string);
								if (webhookResponse.ok) {
									webhookWorked = true;
									return interaction.editReply({
										components: [
											buildSentMessageContainer(content, dmToTicketFooter).toJSON(),
										],
									});
								}
							} catch (e) {}
						}
					}
				}

				if (!webhookWorked) {
					const response = await fetch(
						`https://discord.com/api/v10/channels/${ticketData.threadId}/messages`,
						{
							method: "POST",
							headers: {
								Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
								"Content-Type": "application/json",
							},
							body: JSON.stringify({
								flags: 32768,
								components: [
									{
										type: 10,
										content: content,
									},
									{
										type: 17,
										accent_color: null,
										spoiler: false,
										components: [
											{
												type: 10,
												content: dmToTicketFooter,
											},
										],
									},
								],
							}),
						},
					);

					if (!response.ok) {
						throw new Error(`Failed to send message: ${response.status}`);
					}
				}

				const container = buildSentMessageContainer(content, dmToTicketFooter);

				return interaction.editReply({
					components: [container],
				});
			} else {
				if (!channel || channel.type !== 12 || !channel.name) {
					return sendAlertMessage({
						interaction,
						content: "This command can only be used in ticket threads.",
						type: "error",
					});
				}

				const threadData = await db.get(`thread:${channel.id}`);
				if (!threadData || !threadData.ticketId) {
					return sendAlertMessage({
						interaction,
						content: "This is not a valid ticket thread.",
						type: "error",
					});
				}

				const ticketData = await db.get(`ticket:${threadData.ticketId}`);
				if (!ticketData || ticketData.status !== "open") {
					return sendAlertMessage({
						interaction,
						content: "This ticket is not active or doesn't exist.",
						type: "error",
					});
				}

				try {
					const dmResponse = await fetch(
						`https://discord.com/api/v10/users/@me/channels`,
						{
							method: "POST",
							headers: {
								Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
								"Content-Type": "application/json",
							},
							body: JSON.stringify({
								recipient_id: ticketData.userId,
							}),
						},
					);

					if (!dmResponse.ok) {
						throw new Error(`Failed to create DM: ${dmResponse.status}`);
					}

					const dmChannel = await dmResponse.json();
					const messageResponse = await fetch(
						`https://discord.com/api/v10/channels/${dmChannel.id}/messages`,
						{
							method: "POST",
							headers: {
								Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
								"Content-Type": "application/json",
							},
							body: JSON.stringify({
								components: [
									{
										type: 10,
										content: content,
									},
									{
										type: 17,
										accent_color: null,
										spoiler: false,
										components: [
											{
												type: 10,
												content: `-# Replied by staff ${getEmoji("seal")}`,
											},
										],
									},
								],
								flags: 32768,
							}),
						},
					);

					if (!messageResponse.ok) {
						throw new Error(`Failed to send message: ${messageResponse.status}`);
					}

					const container = buildSentMessageContainer(
						content,
						"-# Response sent to user via DM.",
					);

					return interaction.editReply({
						components: [container],
					});
				} catch (dmError) {
					console.error("DM Error:", dmError);
					return sendAlertMessage({
						interaction,
						content: "Could not send DM to user. They may have DMs disabled.",
						type: "error",
					});
				}
			}
		} catch (error) {
			console.error("Error in /send command:", error);
			return sendAlertMessage({
				interaction,
				content: "An error occurred while sending the message.",
				type: "error",
			});
		}
	},
};

export default sendCommand;
