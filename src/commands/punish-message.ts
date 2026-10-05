import {
	ActionRowBuilder,
	CommandContext,
	ContainerBuilder,
	IntegrationType,
	InteractionFlags,
	MessageCommandBuilder,
	MiniPermFlags,
	SeparatorBuilder,
	SeparatorSpacingSize,
	StringSelectMenuBuilder,
	TextDisplayBuilder,
} from "@minesa-org/mini-interaction";
import type {
	InteractionCommand,
	MessageActionRowComponent,
	MessageContextMenuInteraction,
} from "@minesa-org/mini-interaction";
import {
	applyPunishmentCase,
	buildPunishmentFailureContainer,
	buildPunishmentResultContainer,
	buildScoreProgressBar,
	countActiveCases,
	extractMessageTextFromMessage,
	fetchGuild,
	getPunishmentConfig,
	getPunishmentRecord,
} from "../utils/punishment.ts";
import type {
	PunishmentConfig,
	PunishmentMemberRecord,
} from "../utils/punishment.ts";
import { db } from "../utils/database.ts";
import { getEmoji } from "../utils/index.ts";

/** Component ids for the context menu flow. */
export const PUNISH_MESSAGE_REASON_SELECT_ID = "punishment:message_reason";
export const PUNISH_MESSAGE_CUSTOM_REASON_VALUE = "custom-reason";
export const PUNISH_MESSAGE_CUSTOM_REASON_MODAL_ID =
	"punishment-message-custom-reason-modal";

const PREVIEW_MAX_CHARS = 900;
const PENDING_TTL_MS = 15 * 60 * 1000;

/**
 * A punishment started from the context menu has to remember which message was
 * flagged between the right-click, the reason select and the optional
 * custom-reason modal. Keyed by the moderator and time limited, so a menu left
 * open overnight cannot punish someone later.
 */
export type PendingMessagePunishment = {
	guildId: string;
	guildName: string;
	channelId: string;
	messageId: string;
	targetUserId: string;
	targetTag: string;
	preview: string;
	createdAt: number;
};

type ReplyableInteraction = {
	deferReply: (options?: { flags?: InteractionFlags | InteractionFlags[] }) => unknown;
	// Loosely typed on purpose: this is driven from both a select menu and a
	// modal submit, which expose different reply signatures.
	editReply: (data?: any) => Promise<unknown>;
};

function pendingKey(moderatorId: string) {
	return `punishment:messagePending:${moderatorId}`;
}

export async function savePendingMessagePunishment(
	moderatorId: string,
	pending: Omit<PendingMessagePunishment, "createdAt">,
) {
	await db.set(pendingKey(moderatorId), { ...pending, createdAt: Date.now() });
}

export async function getPendingMessagePunishment(
	moderatorId: string,
): Promise<PendingMessagePunishment | null> {
	const stored = (await db.get(pendingKey(moderatorId)).catch(() => null)) as Record<
		string,
		unknown
	> | null;
	const record = stored && typeof stored === "object" ? stored : {};

	const guildId = typeof record.guildId === "string" ? record.guildId : null;
	const channelId = typeof record.channelId === "string" ? record.channelId : null;
	const messageId = typeof record.messageId === "string" ? record.messageId : null;
	const targetUserId = typeof record.targetUserId === "string" ? record.targetUserId : null;
	const createdAt = typeof record.createdAt === "number" ? record.createdAt : 0;

	if (!guildId || !channelId || !messageId || !targetUserId) return null;

	if (Date.now() - createdAt > PENDING_TTL_MS) {
		await db.delete(pendingKey(moderatorId)).catch(() => {});
		return null;
	}

	return {
		guildId,
		channelId,
		messageId,
		targetUserId,
		createdAt,
		guildName: typeof record.guildName === "string" ? record.guildName : "this server",
		targetTag: typeof record.targetTag === "string" ? record.targetTag : "",
		preview: typeof record.preview === "string" ? record.preview : "",
	};
}

export async function clearPendingMessagePunishment(moderatorId: string) {
	await db.delete(pendingKey(moderatorId)).catch(() => {});
}

/**
 * The ephemeral prompt shown after a moderator right-clicks a message.
 */
export function buildMessagePunishPromptContainer({
	pending,
	record,
	config,
}: {
	pending: PendingMessagePunishment;
	record: PunishmentMemberRecord;
	config: PunishmentConfig;
}) {
	const jump = `https://discord.com/channels/${pending.guildId}/${pending.channelId}/${pending.messageId}`;

	return new ContainerBuilder()
		.setAccentColor(0xfaa61a)
		.addComponent(
			new TextDisplayBuilder().setContent(
				`## ${getEmoji("danger")} Punish <@${pending.targetUserId}>`,
			),
		)
		.addComponent(
			new TextDisplayBuilder().setContent(
				[
					`**Offending message** — [jump to message](${jump})`,
					pending.preview ? `\`\`\`\n${pending.preview}\n\`\`\`` : "-# (no readable text)",
				].join("\n"),
			),
		)
		.addComponent(
			new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
		)
		.addComponent(
			new TextDisplayBuilder().setContent(
				[
					`- **Current score:** ${record.score} / ${config.banThreshold} \`${buildScoreProgressBar(record.score, config.banThreshold)}\``,
					`- **Active cases:** ${countActiveCases(record)}`,
					"-# Pick a reason below. The action is chosen by the ladder unless you force one.",
				].join("\n"),
			),
		);
}

/**
 * Reasons shown in the select: the prepared reasons plus a free text escape
 * hatch. Discord only allows 25 options per select.
 */
export function buildMessagePunishReasonOptions(config: PunishmentConfig) {
	const options = config.reasons
		.slice(0, 24)
		.map((reason) => ({
			label: reason.title.slice(0, 100),
			value: reason.id,
			...(reason.detail ? { description: reason.detail.slice(0, 100) } : {}),
		}));

	options.push({ label: "Custom reason…", value: PUNISH_MESSAGE_CUSTOM_REASON_VALUE });

	return options;
}

/**
 * Applies the punishment for a message flagged through the context menu. The
 * ladder, the DM and the logging all come from the shared punishment engine, so
 * this path can never drift from `/punishment member`.
 */
export async function punishFlaggedMessage({
	moderatorId,
	reason,
	reasonId,
	interaction,
}: {
	moderatorId: string;
	reason: string;
	reasonId?: string | null;
	interaction: ReplyableInteraction;
}): Promise<void> {
	const pending = await getPendingMessagePunishment(moderatorId);

	if (!pending) {
		await interaction.editReply({
			components: [
				buildPunishmentFailureContainer({
					targetUserId: "this member",
					reason,
					error:
						"This request expired or was replaced. Right-click the message again and start over.",
				}),
			],
		});
		return;
	}

	const outcome = await applyPunishmentCase({
		guildId: pending.guildId,
		guildName: pending.guildName,
		targetUserId: pending.targetUserId,
		moderatorId,
		reason,
		reasonId,
		channelId: pending.channelId,
		messageId: pending.messageId,
	});

	if (!outcome.ok || !outcome.plan || !outcome.record || !outcome.config) {
		await clearPendingMessagePunishment(moderatorId);
		await interaction.editReply({
			components: [
				buildPunishmentFailureContainer({
					targetUserId: pending.targetUserId,
					reason,
					error: outcome.error ?? "The punishment could not be applied.",
				}),
			],
		});
		return;
	}

	await clearPendingMessagePunishment(moderatorId);

	await interaction.editReply({
		components: [
			buildPunishmentResultContainer({
				targetUserId: pending.targetUserId,
				plan: outcome.plan,
				reason,
				score: outcome.plan.scoreAfter,
				config: outcome.config,
				record: outcome.record,
				dmSent: outcome.dmSent ?? false,
				guildName: outcome.guildName ?? pending.guildName,
			}),
		],
	});
}

function buildBlockedContainer(title: string, detail: string) {
	return new ContainerBuilder()
		.setAccentColor(0xfaa61a)
		.addComponent(new TextDisplayBuilder().setContent(`## ${getEmoji("info")} ${title}`))
		.addComponent(new TextDisplayBuilder().setContent(detail));
}

function trimPreview(text: string) {
	const trimmed = text.trim();
	if (trimmed.length <= PREVIEW_MAX_CHARS) return trimmed;
	return `${trimmed.slice(0, PREVIEW_MAX_CHARS)}\n…`;
}

const punishMessageCommand: InteractionCommand = {
	data: new MessageCommandBuilder()
		.setName("Punish Message")
		.setNameLocalizations({
			tr: "Mesajı Cezalandır",
			it: "Punish Messaggio",
			ro: "Pedepsează Mesajul",
			el: "Τιμωρία Μηνύματος",
			"pt-BR": "Punir Mensagem",
			"zh-CN": "惩罚消息",
		})
		// Same gate as `/punishment`: the ladder can time out, kick and ban.
		// Context menu builders take a permissions *string*, unlike the chat
		// input builder which accepts a bigint.
		.setDefaultMemberPermissions(
			(
				MiniPermFlags.KickMembers | MiniPermFlags.BanMembers | MiniPermFlags.ModerateMembers
			).toString(),
		)
		.setContexts([CommandContext.Guild])
		.setIntegrationTypes([IntegrationType.GuildInstall]),

	handler: async (interaction: MessageContextMenuInteraction) => {
		await handlePunishMessage(interaction);
	},
};

export default punishMessageCommand;

async function handlePunishMessage(
	interaction: MessageContextMenuInteraction,
): Promise<void> {
	const moderator = interaction.user ?? interaction.member?.user;
	const guildId = interaction.guild_id;

	if (!moderator || !guildId) {
		await interaction.reply({
			flags: InteractionFlags.Ephemeral | InteractionFlags.IsComponentsV2,
			components: [
				buildBlockedContainer(
					"Server only",
					"This command only works on messages inside a server.",
				),
			],
		});
		return;
	}

	await interaction.deferReply({
		flags: [InteractionFlags.Ephemeral, InteractionFlags.IsComponentsV2],
	});

	const targetMessage = interaction.targetMessage;
	const targetId = interaction.data.target_id;
	const author = targetMessage?.author;

	if (!targetMessage || !targetId || !author) {
		await interaction.editReply({
			components: [
				buildBlockedContainer(
					"Nothing to punish",
					"This message could not be read. It may be a system message or already deleted.",
				),
			],
		});
		return;
	}

	const blockReason = describeBlockedTarget({
		authorId: author.id,
		moderatorId: moderator.id,
		applicationId: interaction.application_id,
		isBot: Boolean(author.bot),
	});

	if (blockReason) {
		await interaction.editReply({
			components: [buildBlockedContainer("Cannot punish", blockReason)],
		});
		return;
	}

	const guild = await fetchGuild(guildId).catch(() => null);
	const guildName = typeof guild?.name === "string" ? guild.name : "this server";
	const channelId = targetMessage.channel_id ?? interaction.channel?.id ?? "";

	const pending: Omit<PendingMessagePunishment, "createdAt"> = {
		guildId,
		guildName,
		channelId,
		messageId: targetMessage.id,
		targetUserId: author.id,
		targetTag: author.global_name ?? author.username,
		preview: trimPreview(extractMessageTextFromMessage(targetMessage as never)),
	};

	// The select menu and the custom-reason modal both read this back, so the
	// flagged message survives between the right-click and the choice.
	await savePendingMessagePunishment(moderator.id, pending);

	const config = await getPunishmentConfig(guildId);
	const record = await getPunishmentRecord(guildId, author.id);

	const components: Array<ContainerBuilder | ActionRowBuilder<MessageActionRowComponent>> = [
		buildMessagePunishPromptContainer({
			pending: { ...pending, createdAt: Date.now() },
			record,
			config,
		}),
	];

	if (config.reasons.length === 0) {
		components.push(
			new ContainerBuilder()
				.setAccentColor(0x0a84ff)
				.addComponent(
					new TextDisplayBuilder().setContent(
						[
							`-# ${getEmoji("info")} No prepared reasons yet.`,
							"-# Run `/punishment setup` to build them, or pick **Custom reason…** below.",
						].join("\n"),
					),
				),
		);
	}

	components.push(
		new ActionRowBuilder<MessageActionRowComponent>().addComponents(
			new StringSelectMenuBuilder()
				.setCustomId(PUNISH_MESSAGE_REASON_SELECT_ID)
				.setPlaceholder("Select the reason for this message")
				.setMinValues(1)
				.setMaxValues(1)
				.setOptions(buildMessagePunishReasonOptions(config)),
		),
	);

	await interaction.editReply({ components });
}

function describeBlockedTarget({
	authorId,
	moderatorId,
	applicationId,
	isBot,
}: {
	authorId: string;
	moderatorId: string;
	applicationId: string;
	isBot: boolean;
}): string | null {
	if (isBot) return "That message was sent by a bot.";
	if (authorId === moderatorId) return "That is your own message — you cannot punish yourself.";
	if (authorId === applicationId) return "That message was sent by me, so I cannot punish myself.";
	return null;
}
