import {
	CommandContext,
	ContainerBuilder,
	IntegrationType,
	InteractionFlags,
	MessageCommandBuilder,
	MiniPermFlags,
	TextDisplayBuilder,
} from "@minesa-org/mini-interaction";
import type {
	InteractionCommand,
	MessageContextMenuInteraction,
} from "@minesa-org/mini-interaction";
import { db } from "../utils/database.ts";
import { fetchDiscord } from "../utils/discord.ts";
import { getEmoji, sendAlertMessage } from "../utils/index.ts";

const GUILD_TEXT_CHANNEL = 0;
const PRIVATE_THREAD = 12;
const THREAD_CHANNEL_TYPES = new Set([10, 11, 12]);
const REQUIRED_APP_PERMISSIONS =
	MiniPermFlags.ManageThreads | MiniPermFlags.CreatePrivateThreads;
const MAX_QUOTED_MESSAGE_LENGTH = 1500;

const quickTicket: InteractionCommand = {
	data: new MessageCommandBuilder()
		.setName("Quick Ticket")
		.setNameLocalizations({
			it: "Biglietto Rapido",
			tr: "Hızlı Talep Formu",
			ro: "Bilet Rapid",
			el: "Γρήγορο Εισιτήριο",
			"zh-CN": "快速票证",
			"pt-BR": "Ingresso Rápido",
		})
		.setContexts([CommandContext.Guild])
		.setIntegrationTypes([IntegrationType.GuildInstall]),

	handler: async (interaction: MessageContextMenuInteraction) => {
		await interaction.deferReply({
			flags: InteractionFlags.Ephemeral,
		});

		if (!hasAppPermissions(interaction.app_permissions)) {
			return sendAlertMessage({
				interaction,
				content: "Let's be sure I have permission to __create private threads__.",
				type: "error",
				tag: "Quick Ticket",
			});
		}

		const user = interaction.user ?? interaction.member?.user;
		const message = interaction.targetMessage;
		const guildId = interaction.guild_id;

		if (!user || !guildId || !message) {
			return sendAlertMessage({
				interaction,
				content: "Could not resolve the selected message.",
				type: "error",
				tag: "Quick Ticket",
			});
		}

		const channelType = await getChannelType(
			message.channel_id,
			interaction.channel?.type,
		);

		if (THREAD_CHANNEL_TYPES.has(channelType)) {
			return sendAlertMessage({
				interaction,
				content: "You can't create a thread inside another thread.",
				type: "error",
				tag: "Wait, what?",
				alertReaction: "reactions.kaeru.haha",
			});
		}

		if (channelType !== GUILD_TEXT_CHANNEL) {
			return sendAlertMessage({
				interaction,
				content: "Quick Ticket can only be used from a standard text channel.",
				type: "error",
				tag: "Channel Type",
			});
		}

		try {
			const thread = await fetchDiscord(
				`/channels/${message.channel_id}/threads`,
				process.env.DISCORD_BOT_TOKEN!,
				true,
				"POST",
				{
					name: `- Quick-ticket by ${user.username}`.slice(0, 100),
					auto_archive_duration: 60,
					type: PRIVATE_THREAD,
					invitable: true,
				},
			);

			await fetchDiscord(
				`/channels/${thread.id}/thread-members/${user.id}`,
				process.env.DISCORD_BOT_TOKEN!,
				true,
				"PUT",
			);

			const ticketId = Date.now().toString();
			const quotedMessage = formatQuotedMessage(message.content);
			const messageUrl = `https://discord.com/channels/${guildId}/${message.channel_id}/${message.id}`;
			const authorName = message.author?.username ?? "Unknown";

			await fetchDiscord(
				`/channels/${thread.id}/messages`,
				process.env.DISCORD_BOT_TOKEN!,
				true,
				"POST",
				{
					components: [
						new ContainerBuilder()
							.addComponent(
								new TextDisplayBuilder().setContent("-# Quick Ticket"),
							)
							.addComponent(
								new TextDisplayBuilder().setContent(
									[
										`## ${getEmoji("ticket.create")} Quick-Ticket Created`,
										`<@${user.id}>, you have opened a quick-action for this message.`,
										quotedMessage ? `> ${quotedMessage}` : "> -# No readable text content.",
										`> -# Jump to [message](${messageUrl})`,
										`- Message sent by __@${authorName}__`,
										"",
										"-# Use /close in this thread when it is resolved.",
									].join("\n"),
								),
							)
							.toJSON(),
						{
							type: 1,
							components: [
								{
									type: 2,
									custom_id: "ticket:invite_creator",
									style: 2,
									label: "Invite Creator",
								},
							],
						},
					],
					flags: InteractionFlags.IsComponentsV2,
				},
			);

			await Promise.all([
				db.set(`ticket:${ticketId}`, {
					ticketId,
					guildId,
					channelId: message.channel_id,
					userId: user.id,
					username: user.username,
					threadId: thread.id,
					title: "Quick Ticket",
					description: message.content || "Quick ticket from message context menu.",
					status: "open",
					sourceMessageId: message.id,
					sourceChannelId: message.channel_id,
				}),
				db.set(`thread:${thread.id}`, {
					ticketId,
				}),
			]);

			return interaction.editReply({
				content: `# ${getEmoji("ticket.created")} Created <#${thread.id}>\nNow, you can talk about this issue with staff members or server members.`,
			});
		} catch (error) {
			console.error("Error creating quick ticket:", error);
			return sendAlertMessage({
				interaction,
				content: "Failed to create the quick ticket. Check my thread permissions in this channel.",
				type: "error",
				tag: "Quick Ticket",
			});
		}
	},
};

function hasAppPermissions(rawPermissions?: string): boolean {
	if (!rawPermissions) return false;

	try {
		const permissions = BigInt(rawPermissions);
		return (permissions & REQUIRED_APP_PERMISSIONS) === REQUIRED_APP_PERMISSIONS;
	} catch {
		return false;
	}
}

async function getChannelType(channelId: string, knownType?: number): Promise<number> {
	if (typeof knownType === "number") return knownType;

	const channel = await fetchDiscord(
		`/channels/${channelId}`,
		process.env.DISCORD_BOT_TOKEN!,
		true,
	);

	return typeof channel?.type === "number" ? channel.type : -1;
}

function formatQuotedMessage(content?: string): string {
	if (!content?.trim()) return "";

	const normalized = content.trim().replace(/\s+/g, " ");
	if (normalized.length <= MAX_QUOTED_MESSAGE_LENGTH) return normalized;

	return `${normalized.slice(0, MAX_QUOTED_MESSAGE_LENGTH - 3)}...`;
}

export default quickTicket;
