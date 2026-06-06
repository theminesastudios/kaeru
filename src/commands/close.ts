import {
	CommandBuilder,
	CommandContext,
	IntegrationType,
	InteractionFlags,
	MiniPermFlags,
} from "@minesa-org/mini-interaction";
import type { CommandInteraction, InteractionCommand } from "@minesa-org/mini-interaction";
import { db } from "../utils/database.ts";
import { fetchDiscord } from "../utils/discord.ts";
import { getEmoji, sendAlertMessage } from "../utils/index.ts";
import { clearActiveTicket } from "../utils/ticketControls.ts";

const closeCommand: InteractionCommand = {
	data: new CommandBuilder()
		.setName("close")
		.setDescription("Close and archive the current ticket thread")
		.setContexts([CommandContext.Guild, CommandContext.Bot])
		.setIntegrationTypes([IntegrationType.GuildInstall, IntegrationType.UserInstall])
		.setDefaultMemberPermissions(MiniPermFlags.ManageThreads),

	handler: async (interaction: CommandInteraction) => {
		const user = interaction.user ?? interaction.member?.user;
		const channel = interaction.channel;
		const isDM = !interaction.guild_id;

		if (!user) {
			return sendAlertMessage({
				interaction,
				content: "Could not resolve user.",
				type: "error",
			});
		}

		await interaction.deferReply({
			flags: InteractionFlags.Ephemeral,
		});

		if (isDM) {
			// Check for close cooldown (30 minutes) - only for users in DMs
			const cooldownKey = `cooldown:close:${user.id}`;
			try {
				const cooldownData = await db.get(cooldownKey);
				const now = Date.now();

				if (cooldownData && (cooldownData as any).expiresAt > now) {
					const timestamp = Math.floor((cooldownData as any).expiresAt / 1000);

					return sendAlertMessage({
						interaction,
						content: `**You're on cooldown!**\n\nYou closed a ticket too quickly. Please wait before closing another ticket.\n\n-# ${getEmoji("timer")} **Time remaining:** <t:${timestamp}:R>`,
						type: "error",
					});
				}
			} catch (cooldownError) {
				console.error("Error checking cooldown:", cooldownError);
			}

			try {
				const userTicketData = await db.get(`user:${user.id}`);
				if (!userTicketData || !userTicketData.activeTicketId) {
					return sendAlertMessage({
						interaction,
						content: `**You don't have an active ticket to close.**\n\n- If you are a staff member, please use this command inside the ticket thread you wish to close.\n- If you are a user, you must have an active ticketmail session to close it via DM.`,
						type: "error",
					});
				}

				const ticketData = await db.get(`ticket:${userTicketData.activeTicketId}`);
				if (!ticketData) {
					return sendAlertMessage({
						interaction,
						content: "Ticket data not found.",
						type: "error",
					});
				}

				await interaction.editReply({
					content: `${getEmoji("ticket.archive.user")} Closing your ticket...`,
				});

				// Warn user about cooldown policy via DM
				try {
					const dmChannel = await fetchDiscord(
						`/users/@me/channels`,
						process.env.DISCORD_BOT_TOKEN!,
						true,
						"POST",
						{ recipient_id: ticketData.userId },
					);

					if (dmChannel?.id) {
						await fetchDiscord(
							`/channels/${dmChannel.id}/messages`,
							process.env.DISCORD_BOT_TOKEN!,
							true,
							"POST",
							{
								content: `-# **Warning:** Closing tickets too quickly will put you on a ${getEmoji("timer")} 30-minute cooldown before you can close another ticket.`,
							},
						);
					}
				} catch (warnError) {
					console.error("Error sending cooldown warning DM:", warnError);
				}

				try {
					await fetchDiscord(
						`/channels/${ticketData.threadId}/messages`,
						process.env.DISCORD_BOT_TOKEN!,
						true,
						"POST",
						{
							content: `## ${getEmoji("ticket.archive.user")} Ticket Closed\n\n- **User:** ${ticketData.username}\n\n-# This ticket has been closed by the user.`,
						},
					);
				} catch (messageError) {
					console.error("Error sending archive message to thread:", messageError);
				}

				try {
					await fetchDiscord(
						`/channels/${ticketData.threadId}`,
						process.env.DISCORD_BOT_TOKEN!,
						true,
						"PATCH",
						{ locked: true, archived: true },
					);
				} catch (archiveError) {
					console.error("Error archiving thread:", archiveError);
				}

				await clearActiveTicket(ticketData);

				try {
					const cooldownDuration = 30 * 60 * 1000;
					await db.set(`cooldown:close:${user.id}`, {
						userId: user.id,
						expiresAt: Date.now() + cooldownDuration,
						reason: "ticket_close_cooldown",
					});
				} catch (cooldownError) {
					console.error("Error setting cooldown:", cooldownError);
				}

				try {
					await db.delete(`ticket:${userTicketData.activeTicketId}`);
					await db.delete(`thread:${ticketData.threadId}`);
				} catch (deleteError) {
					console.error("Error deleting ticket data:", deleteError);
				}

				return interaction.editReply({
					content: `## ${getEmoji("ticket.archive.user")} **Your ticket has been closed!**\n\nIf you need further assistance, you can create a new ticket anytime using </create:1477209072800632845>.`,
				});
			} catch (error) {
				console.error("Error closing ticket in DM:", error);
				return sendAlertMessage({
					interaction,
					content: "Failed to close the ticket. Please try again.",
					type: "error",
				});
			}
		}

		if (
			!channel ||
			(channel.type !== 12 && channel.type !== 10 && channel.type !== 11) ||
			!channel.name
		) {
			return sendAlertMessage({
				interaction,
				content: "This command can only be used in ticket threads.",
				type: "error",
			});
		}

		try {
			const threadData = await db.get(`thread:${channel.id}`);
			if (!threadData || !threadData.ticketId) {
				return sendAlertMessage({
					interaction,
					content: "This is not a valid ticket thread.",
					type: "error",
				});
			}

			const ticketData = await db.get(`ticket:${threadData.ticketId}`);
			if (!ticketData) {
				return sendAlertMessage({
					interaction,
					content: "Ticket data not found.",
					type: "error",
				});
			}

			await interaction.editReply({
				content: `${getEmoji("ticket.archive.server")} Closing the ticket...`,
			});

			try {
				await fetchDiscord(
					`/channels/${channel.id}/messages`,
					process.env.DISCORD_BOT_TOKEN!,
					true,
					"POST",
					{
						content: `## ${getEmoji("ticket.archive.server")} Ticket Archived\n\n- **User:** ${ticketData.username}\n\n-# This ticket has been archived by staff.`,
					},
				);
			} catch (messageError) {
				console.error("Error sending archive message to thread:", messageError);
			}

			await interaction.editReply({
				content: `${getEmoji("ticket.archive.server")} **Archived the ticket.**`,
			});

			await fetchDiscord(
				`/channels/${channel.id}`,
				process.env.DISCORD_BOT_TOKEN!,
				true,
				"PATCH",
				{ locked: true, archived: true },
			);

			await clearActiveTicket(ticketData);

			try {
				const dmChannel = await fetchDiscord(
					`/users/@me/channels`,
					process.env.DISCORD_BOT_TOKEN!,
					true,
					"POST",
					{ recipient_id: ticketData.userId },
				);

				if (dmChannel?.id) {
					await fetchDiscord(
						`/channels/${dmChannel.id}/messages`,
						process.env.DISCORD_BOT_TOKEN!,
						true,
						"POST",
						{
							components: [
								{
									type: 17,
									accent_color: null,
									spoiler: false,
									components: [
										{
											type: 10,
											content: `## Your ticket has been closed!\nStaff have resolved your issue. If you need further assistance, you can create a new ticket anytime using </create:1477209072800632845> in the DM after [User Installing](https://discord.com/oauth2/authorize?client_id=${
												process.env.DISCORD_APPLICATION_ID
											}&response_type=code&redirect_uri=${encodeURIComponent(
												process.env.DISCORD_REDIRECT_URI || "",
											)}&scope=applications.commands+identify+guilds+role_connections.write&integration_type=1) the app.`,
										},
										{
											type: 10,
											content: `-# Ticket closed by staff ${getEmoji("ticket.archive.server")}`,
										},
									],
								},
							],
							flags: 32768,
						},
					);
				}
			} catch (dmError) {
				console.warn("Could not notify user of closure via DM:", dmError);
			}

			await db.delete(`ticket:${threadData.ticketId}`);
			await db.delete(`thread:${channel.id}`);
		} catch (error) {
			console.error("Error closing ticket:", error);
			return sendAlertMessage({
				interaction,
				content: "Failed to close the ticket. Please try again.",
				type: "error",
			});
		}
	},
};

export default closeCommand;
