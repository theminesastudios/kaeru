import {
	ContainerBuilder,
	InteractionFlags,
	TextDisplayBuilder,
} from "@minesa-org/mini-interaction";
import type {
	InteractionModal,
	ModalSubmitInteraction,
} from "@minesa-org/mini-interaction";
import { db } from "../../utils/database.ts";
import { fetchDiscord, getOrCreateWebhookUrl } from "../../utils/discord.ts";
import { getEmoji } from "../../utils/index.ts";
import { summarizeTicketTitle } from "../../utils/ticketTitle.ts";

const MIN_DESCRIPTION_LENGTH = 25;

function buildErrorContainer(message: string) {
	return new ContainerBuilder()
		.addComponent(
			new TextDisplayBuilder().setContent(
				`## ${getEmoji("error")} Ticket creation failed`,
			),
		)
		.addComponent(new TextDisplayBuilder().setContent(message));
}

const createIssueModal: InteractionModal = {
	customId: "create:issue_modal",

	handler: async (interaction: ModalSubmitInteraction) => {
		const user = interaction.user ?? interaction.member?.user;
		if (!user) return;

		await interaction.deferReply({
			flags: InteractionFlags.IsComponentsV2 | InteractionFlags.Ephemeral,
		});

		const description =
			interaction.getTextFieldValue("issue_description")?.trim() || "";

		if (description.length < MIN_DESCRIPTION_LENGTH) {
			const pendingTicket = await db.get(`pendingTicketCreate:${user.id}`).catch(
				() => null,
			);
			const messageInteractionToken =
				typeof pendingTicket?.messageInteractionToken === "string"
					? pendingTicket.messageInteractionToken
					: null;
			const errorPayload = {
				components: [
					buildErrorContainer(
						`Please describe your issue with at least ${MIN_DESCRIPTION_LENGTH} characters.`,
					).toJSON(),
				],
				flags: 32768,
			};

			if (messageInteractionToken) {
				await editOriginalInteractionMessage(
					messageInteractionToken,
					errorPayload,
				).catch((error) => {
					console.warn(
						"[Kaeru] Failed to edit original create message for validation error:",
						error,
					);
				});
				await deleteOriginalInteractionMessage(interaction.token).catch(() => {});
				return;
			}

			return interaction.editReply({
				components: errorPayload.components,
			});
		}

		try {
			const pendingTicket = await db.get(`pendingTicketCreate:${user.id}`);
			const guildId =
				typeof pendingTicket?.guildId === "string" ? pendingTicket.guildId : null;
			const messageInteractionToken =
				typeof pendingTicket?.messageInteractionToken === "string"
					? pendingTicket.messageInteractionToken
					: null;

			if (!guildId) {
				return interaction.editReply({
					components: [
						buildErrorContainer(
							"Please run </create:1477209072800632845> again and select a server before describing your issue.",
						).toJSON(),
					],
				});
			}

			const [userTicketData, guildData, counterData] = await Promise.all([
				db.get(`user:${user.id}`),
				db.get(`guild:${guildId}`),
				db.get(`counter:${guildId}`),
			]);

			if (userTicketData?.activeTicketId) {
				const existingTicket = await db.get(
					`ticket:${userTicketData.activeTicketId}`,
				);

				if (existingTicket?.status === "open") {
					const container = new ContainerBuilder()
						.addComponent(
							new TextDisplayBuilder().setContent(
								`## ${getEmoji("error")} You already have an open ticket!`,
							),
						)
						.addComponent(
							new TextDisplayBuilder().setContent(
								`Please use </send:1477601535692247294> in DMs to continue.\n\nYour ticket: <#${existingTicket.threadId}>`,
							),
						);

					return interaction.editReply({
						components: [container.toJSON()],
					});
				}
			}

			let guildName =
				typeof guildData?.guildName === "string" ? guildData.guildName : null;
			let systemChannelId =
				typeof guildData?.systemChannelId === "string"
					? guildData.systemChannelId
					: null;

			if (!guildName || (!guildData?.ticketChannelId && !systemChannelId)) {
				const guild = await fetchDiscord(
					`/guilds/${guildId}`,
					process.env.DISCORD_BOT_TOKEN!,
					true,
					"GET",
					null,
					3000,
				);

				guildName =
					typeof guild?.name === "string" && guild.name.length > 0
						? guild.name
						: guildName;
				systemChannelId =
					typeof guild?.system_channel_id === "string"
						? guild.system_channel_id
						: systemChannelId;
			}

			const targetChannelId =
				typeof guildData?.ticketChannelId === "string"
					? guildData.ticketChannelId
					: systemChannelId;

			if (!targetChannelId) {
				return interaction.editReply({
					components: [
						buildErrorContainer(
							"This server does not have a usable ticket channel configured.",
						).toJSON(),
					],
				});
			}

			const caseNumber = Number(counterData?.lastCaseNumber || 0) + 1;
			const ticketTitle = await summarizeTicketTitle(description);

			const thread = await fetchDiscord(
				`/channels/${targetChannelId}/threads`,
				process.env.DISCORD_BOT_TOKEN!,
				true,
				"POST",
				{
					name: `#${caseNumber} - ${ticketTitle}`.slice(0, 100),
					auto_archive_duration: 10080,
					type: 12,
				},
			);

			console.info(
				`[Kaeru] Created thread ${thread.id} for /create in guild ${guildId}.`,
			);

			const ticketId = Date.now().toString();
			const pingMention = guildData?.pingRoleId
				? `<@&${guildData.pingRoleId}>`
				: "@here";
			let webhookUrl =
				typeof guildData?.webhookUrl === "string" ? guildData.webhookUrl : null;

			const starterMessage = fetchDiscord(
				`/channels/${thread.id}/messages`,
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
									content:
										`## ${getEmoji("ticket.create")} New Ticket #${caseNumber} - ${ticketTitle}\n` +
										`-# [ ${pingMention} ]\n\n**Created by:** ${user.username}`,
								},
								{
									type: 10,
									content:
										"-# Please assist this user with their inquiry using </send:1477601535692247294>.",
								},
								{
									type: 10,
									content:
										"-# Use the button below if you want to invite the ticket creator into this thread.",
								},
							],
						},
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
					flags: 32768,
				},
				2500,
			).catch((messageError) => {
				console.error("Error sending initial thread message:", messageError);
				return null;
			});

			webhookUrl = await sendInitialIssueViaWebhook({
				webhookUrl,
				targetChannelId,
				threadId: thread.id,
				user,
				content: description,
			});

			const guildRecord = {
				...(guildData || {}),
				guildId,
				...(guildName ? { guildName } : {}),
				...(systemChannelId ? { systemChannelId } : {}),
				...(webhookUrl ? { webhookUrl } : {}),
				status: "active",
			};

			const persistenceResults = await Promise.all([
				db.set(`counter:${guildId}`, {
					lastCaseNumber: caseNumber,
				}),
				db.set(`guild:${guildId}`, guildRecord),
				db.set(`ticket:${ticketId}`, {
					ticketId,
					caseNumber,
					guildId,
					channelId: targetChannelId,
					userId: user.id,
					username: user.username,
					threadId: thread.id,
					title: ticketTitle,
					description,
					status: "open",
				}),
				db.set(`thread:${thread.id}`, {
					ticketId,
				}),
				db.set(`user:${user.id}`, {
					...(userTicketData || {}),
					activeTicketId: ticketId,
					guildId,
				}),
				db.delete(`pendingTicketCreate:${user.id}`),
			]);

			void starterMessage;

			if (persistenceResults.some((result) => result === false)) {
				console.warn(
					`[Kaeru] Ticket ${ticketId} created for ${user.id}, but one or more persistence writes failed.`,
				);
			}

			const container = new ContainerBuilder()
				.addComponent(
					new TextDisplayBuilder().setContent(
						`## ${getEmoji("ticket.create")} Ticket created${guildName ? ` in ${guildName}` : ""}!\n` +
							`You can now continue with </send:1477601535692247294> in DMs.\n<#${thread.id}>`,
					),
				);

			const responsePayload = {
				components: [container.toJSON()],
				flags: 32768,
			};

			if (messageInteractionToken) {
				await editOriginalInteractionMessage(
					messageInteractionToken,
					responsePayload,
				);
				await deleteOriginalInteractionMessage(interaction.token);
				return;
			}

			return interaction.editReply(responsePayload);
		} catch (error) {
			console.error("Error in create issue modal handler:", error);
			const errorPayload = {
				components: [
					buildErrorContainer(
						"Failed to create thread. Check bot permissions in the selected server.",
					).toJSON(),
				],
				flags: 32768,
			};

			const pendingTicket = await db.get(`pendingTicketCreate:${user.id}`).catch(
				() => null,
			);
			const messageInteractionToken =
				typeof pendingTicket?.messageInteractionToken === "string"
					? pendingTicket.messageInteractionToken
					: null;

			if (messageInteractionToken) {
				await editOriginalInteractionMessage(
					messageInteractionToken,
					errorPayload,
				).catch((editError) => {
					console.warn(
						"[Kaeru] Failed to edit original create message after error:",
						editError,
					);
				});
				await deleteOriginalInteractionMessage(interaction.token).catch(() => {});
				return;
			}

			return interaction.editReply(errorPayload);
		}
	},
};

export default createIssueModal;

async function sendInitialIssueViaWebhook({
	webhookUrl,
	targetChannelId,
	threadId,
	user,
	content,
}: {
	webhookUrl: string | null;
	targetChannelId: string;
	threadId: string;
	user: { id: string; username: string; avatar?: string | null };
	content: string;
}) {
	const resolvedWebhookUrl =
		webhookUrl ||
		(await getOrCreateWebhookUrl(
			targetChannelId,
			process.env.DISCORD_BOT_TOKEN!,
		));

	if (!resolvedWebhookUrl) {
		await sendInitialIssueFallback(threadId, content);
		return null;
	}

	try {
		for (const chunk of splitDiscordMessage(content)) {
			const response = await fetch(`${resolvedWebhookUrl}?thread_id=${threadId}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					content: chunk,
					username: user.username,
					avatar_url: user.avatar
						? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
						: undefined,
				}),
			});

			if (!response.ok) {
				throw new Error(`Initial issue webhook failed: ${response.status}`);
			}
		}

		return resolvedWebhookUrl;
	} catch (error) {
		console.warn("[Kaeru] Failed to send initial issue via webhook:", error);
		await sendInitialIssueFallback(threadId, content);
		return resolvedWebhookUrl;
	}
}

async function sendInitialIssueFallback(threadId: string, content: string) {
	for (const chunk of splitDiscordMessage(content)) {
		await fetchDiscord(
			`/channels/${threadId}/messages`,
			process.env.DISCORD_BOT_TOKEN!,
			true,
			"POST",
			{
				content: chunk,
			},
		);
	}
}

function splitDiscordMessage(content: string): string[] {
	const chunks: string[] = [];
	let remaining = content.trim();

	while (remaining.length > 2000) {
		let splitIndex = remaining.lastIndexOf("\n", 2000);
		if (splitIndex < 1000) {
			splitIndex = remaining.lastIndexOf(" ", 2000);
		}
		if (splitIndex < 1000) {
			splitIndex = 2000;
		}

		chunks.push(remaining.slice(0, splitIndex).trim());
		remaining = remaining.slice(splitIndex).trim();
	}

	if (remaining) {
		chunks.push(remaining);
	}

	return chunks;
}

async function editOriginalInteractionMessage(
	interactionToken: string,
	payload: unknown,
) {
	const response = await fetch(
		`https://discord.com/api/v10/webhooks/${process.env.DISCORD_APPLICATION_ID}/${interactionToken}/messages/@original`,
		{
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		},
	);

	if (!response.ok) {
		throw new Error(`Failed to edit original interaction message: ${response.status}`);
	}
}

async function deleteOriginalInteractionMessage(interactionToken: string) {
	await fetch(
		`https://discord.com/api/v10/webhooks/${process.env.DISCORD_APPLICATION_ID}/${interactionToken}/messages/@original`,
		{
			method: "DELETE",
		},
	);
}
