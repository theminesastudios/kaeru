import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	CommandBuilder,
	CommandContext,
	ContainerBuilder,
	IntegrationType,
	InteractionFlags,
	TextDisplayBuilder,
} from "@minesa-org/mini-interaction";
import type { APIAttachment } from "discord-api-types/v10";
import type {
	CommandInteraction,
	InteractionCommand,
	MessageActionRowComponent,
} from "@minesa-org/mini-interaction";
import { db } from "../utils/database.ts";
import { getEmoji, getOrCreateWebhookUrl, sendAlertMessage } from "../utils/index.ts";
import {
	canUseTicketStaffControls,
	getUserOpenTickets,
	isTicketOpen,
} from "../utils/ticketControls.ts";

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
		)
		.addAttachmentOption((option) =>
			option
				.setName("attachment")
				.setDescription("Optional file to include with the message")
				.setRequired(false),
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

		const content = options.getString("content", true)!.trim();
		const attachment = options.getAttachment("attachment");
		const sendContent = buildForwardedContent(content, attachment);

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

				const userTickets = await getUserOpenTickets(user.id);
				if (!userTickets.currentTicketId) {
					return sendAlertMessage({
						interaction,
						content: `**You don't have an active ticket.**\n\nIf you need assistance, please use </create:1477209072800632845> in a mutual server first.\n\n-# If you are staff, please use this command inside a ticket thread.`,
						type: "error",
					});
				}

				const ticketData = userTickets.tickets.find(
					(ticket) => ticket.ticketId === userTickets.currentTicketId,
				);

				if (!isTicketOpen(ticketData)) {
					return sendAlertMessage({
						interaction,
						content: "Your ticket is not active or doesn't exist.",
						type: "error",
					});
				}

				if (ticketData.locked) {
					return sendAlertMessage({
						interaction,
						content: "Your ticket is locked by staff right now. Please wait for staff to reopen it before sending more messages.",
						type: "error",
					});
				}

				const guildData = await db.get(`guild:${ticketData.guildId}`);
				let webhookUrl = guildData?.webhookUrl;

				let webhookWorked = false;
				const dmToTicketAckFooter =
					`-# ${getEmoji("reply")} Sent from your DM`;

				const sendWebhookMessage = async (url: string) => {
					return await fetch(`${url}?thread_id=${ticketData.threadId}`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							content: sendContent,
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
									buildSentMessageContainer(sendContent, dmToTicketAckFooter).toJSON(),
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
											buildSentMessageContainer(sendContent, dmToTicketAckFooter).toJSON(),
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
										content: sendContent,
									},
								],
							}),
						},
					);

					if (!response.ok) {
						throw new Error(`Failed to send message: ${response.status}`);
					}
				}

				const container = buildSentMessageContainer(sendContent, dmToTicketAckFooter);

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
				if (!isTicketOpen(ticketData)) {
					return sendAlertMessage({
						interaction,
						content: "This ticket is not active or doesn't exist.",
						type: "error",
					});
				}

				const staffCheck = await canUseTicketStaffControls(interaction, ticketData);
				if (!staffCheck.ok) {
					return sendAlertMessage({
						interaction,
						content: staffCheck.message || "Only staff can send messages from ticket threads.",
						type: "error",
					});
				}

				try {
					const staffToUserDmFooter =
						`-# ${getEmoji("seal")} Staff ${formatTicketShortLabel(ticketData)} -> your DM`;
					const staffToUserAckFooter =
						`-# ${getEmoji("seal")} Sent to @${ticketData.username}`;
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
										content: sendContent,
									},
									{
										type: 17,
										accent_color: null,
										spoiler: false,
										components: [
											{
												type: 10,
												content: staffToUserDmFooter,
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
						sendContent,
						staffToUserAckFooter,
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

function buildForwardedContent(content: string, attachment: APIAttachment | null) {
	const attachmentUrl = attachment?.url || attachment?.proxy_url;
	const parts: string[] = [];

	if (content) {
		parts.push(content);
	}

	if (attachmentUrl) {
		const filename = attachment.filename || "attachment";
		parts.push(`[${filename}](${attachmentUrl})`);
	}

	return parts.join("\n").trim();
}

function formatTicketShortLabel(ticketData: Record<string, any>) {
	return ticketData.caseNumber ? `#${ticketData.caseNumber}` : "ticket";
}
