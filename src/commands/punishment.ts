import {
	ActionRowBuilder,
	ChannelSelectMenuBuilder,
	ChannelType,
	CommandBuilder,
	CommandContext,
	ContainerBuilder,
	IntegrationType,
	InteractionFlags,
	MiniPermFlags,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
} from "@minesa-org/mini-interaction";
import type {
	CommandInteraction,
	InteractionCommand,
	MessageActionRowComponent,
} from "@minesa-org/mini-interaction";
import {
	applyPunishmentCase,
	buildAvatarUrl,
	buildCaseChoices,
	buildForgiveResultContainer,
	buildMemberRecordContainer,
	buildPunishmentFailureContainer,
	buildPunishmentResultContainer,
	buildReasonChoices,
	buildSetupResultContainer,
	countActiveCases,
	fetchChannelName,
	fetchGuild,
	fetchGuildMember,
	fetchRulesChannelText,
	findPreparedReason,
	findRulesChannelId,
	generatePreparedReasons,
	getPunishmentConfig,
	getPunishmentRecord,
	isForgiven,
	logPunishment,
	parseDurationInput,
	removeBan,
	savePunishmentConfig,
	savePunishmentRecord,
} from "../utils/punishment.ts";
import type { PunishmentAction } from "../utils/punishment.ts";
import { getEmoji, sendAlertMessage } from "../utils/index.ts";

export const PUNISHMENT_RULES_CHANNEL_SELECT_ID = "punishment:rules_channel";

/**
 * `/punishment setup` and the rules-channel select menu both drive the same
 * flow, so both only need the reply helpers this function actually uses.
 */
type SetupInteraction = {
	deferReply: (options?: { flags?: InteractionFlags | InteractionFlags[] }) => unknown;
	// Loosely typed on purpose: a slash command and a select menu expose
	// different reply signatures, and only these two helpers are needed here.
	// This mirrors `sendAlertMessage`, which also accepts a generic interaction.
	editReply: (data?: any) => Promise<any>;
};

const punishmentCommand: InteractionCommand = {
	data: new CommandBuilder()
		.setName("punishment")
		.setDescription("Punishment system: rules, scores and moderation actions")
		.setContexts([CommandContext.Guild])
		.setIntegrationTypes([IntegrationType.GuildInstall])
		// Timeouts, kicks and bans all live behind Manage Members (Moderate Members
		// covers timeouts, Kick/Ban Members cover the rest), so the whole command
		// stays hidden from anyone without Manage Members in this server.
		.setDefaultMemberPermissions(
			MiniPermFlags.KickMembers | MiniPermFlags.BanMembers | MiniPermFlags.ModerateMembers,
		)
		.addSubcommand((sub) =>
			sub
				.setName("setup")
				.setDescription("Fetch the rules channel and prepare punishment reasons")
				.addChannelOption((option) =>
					option
						.setName("channel")
						.setDescription("Rules channel to read (defaults to this server's rules channel)")
						.setRequired(false)
						.addChannelTypes(
							ChannelType.GuildText,
							ChannelType.GuildAnnouncement,
							ChannelType.GuildForum,
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("member")
				.setDescription("Punish a member (timeout, then kick, then ban)")
				.addUserOption((option) =>
					option.setName("user").setDescription("The member to punish").setRequired(true),
				)
				.addStringOption((option) =>
					option
						.setName("reason")
						.setDescription("Prepared reason (autocomplete) or a custom reason")
						.setRequired(false)
						.setAutocomplete(true),
				)
				.addStringOption((option) =>
					option
						.setName("duration")
						.setDescription("Timeout length override, e.g. 30m, 12h, 7d")
						.setRequired(false),
				)
				.addStringOption((option) =>
					option
						.setName("action")
						.setDescription("Force an action instead of the automatic ladder")
						.setRequired(false)
						// Labels are single words on purpose: the library runs every
						// choice label through the option-name regex, which rejects
						// spaces, so "Automatic (ladder)" would throw on load.
						.addChoices(
							{ name: "Automatic", value: "auto" },
							{ name: "Timeout", value: "timeout" },
							{ name: "Kick", value: "kick" },
							{ name: "Ban", value: "ban" },
						),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("view")
				.setDescription("Show a member's score and every punishment case")
				.addUserOption((option) =>
					option.setName("user").setDescription("Member to inspect").setRequired(true),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("forgive")
				.setDescription("Remove punishment score from a member")
				.addUserOption((option) =>
					option
						.setName("user")
						.setDescription("Member to forgive")
						.setRequired(true),
				)
				.addStringOption((option) =>
					option
						.setName("case")
						.setDescription("Specific case to forgive (defaults to the most recent)")
						.setRequired(false)
						.setAutocomplete(true),
				),
		),

	handler: async (interaction: CommandInteraction) => {
		const user = interaction.user ?? interaction.member?.user;
		const guildId = interaction.guild_id;

		if (!user || !guildId) {
			return sendAlertMessage({
				interaction,
				content: "This command can only be used within a server.",
				type: "error",
			});
		}

		const subcommand = interaction.options.getSubcommand();

		if (subcommand === "setup") {
			return handleSetup(interaction, user.id);
		}

		if (subcommand === "member") {
			return handlePunish(interaction, user.id, guildId);
		}

		if (subcommand === "view") {
			return handleView(interaction, guildId);
		}

		if (subcommand === "forgive") {
			return handleForgive(interaction, user.id, guildId);
		}
	},
};

export default punishmentCommand;

async function handleSetup(interaction: CommandInteraction, moderatorId: string) {
	const guildId = interaction.guild_id!;
	const guild = await fetchGuild(guildId).catch(() => null);
	const guildName = typeof guild?.name === "string" ? guild.name : "this server";
	const explicitChannel = interaction.options.getChannel("channel");

	if (explicitChannel?.id) {
		return runSetup({ interaction, guildId, guildName, channelId: explicitChannel.id, moderatorId });
	}

	const rulesChannelId = await findRulesChannelId(guildId).catch(() => null);

	if (rulesChannelId) {
		return runSetup({ interaction, guildId, guildName, channelId: rulesChannelId, moderatorId });
	}

	// No community rules channel on this server, so let the moderator pick one.
	await interaction.deferReply({
		flags: [InteractionFlags.Ephemeral, InteractionFlags.IsComponentsV2],
	});

	const select = new ActionRowBuilder<MessageActionRowComponent>().addComponents(
		new ChannelSelectMenuBuilder()
			.setCustomId(PUNISHMENT_RULES_CHANNEL_SELECT_ID)
			.setPlaceholder("Select the channel that holds your rules")
			.setMinValues(1)
			.setMaxValues(1)
			.setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum]),
	);

	const container = new ContainerBuilder()
		.setAccentColor(0x0a84ff)
		.addComponent(
			new TextDisplayBuilder().setContent(`## ${getEmoji("info")} No rules channel set`),
		)
		.addComponent(
			new TextDisplayBuilder().setContent(
				[
					"This server has no community rules channel, so I cannot detect it automatically.",
					"",
					"Pick the channel where your rules live and I will read every message in it — including embeds and containers — then prepare the punishment reasons from it.",
				].join("\n"),
			),
		);

	return interaction.editReply({ components: [container, select] });
}

export async function runSetup({
	interaction,
	guildId,
	guildName,
	channelId,
	moderatorId,
}: {
	interaction: SetupInteraction;
	guildId: string;
	guildName: string;
	channelId: string;
	moderatorId: string;
}) {
	await interaction.deferReply({
		flags: [InteractionFlags.Ephemeral, InteractionFlags.IsComponentsV2],
	});

	try {
		const rulesText = await fetchRulesChannelText(channelId);

		if (!rulesText) {
			return interaction.editReply({
				components: [
					new ContainerBuilder()
						.setAccentColor(0xff5353)
						.addComponent(
							new TextDisplayBuilder().setContent(
								`## ${getEmoji("error")} Nothing to read`,
							),
						)
						.addComponent(
							new TextDisplayBuilder().setContent(
								[
									`<#${channelId}> has no readable messages, embeds or containers.`,
									"",
									"Post your rules there first, then run `/punishment setup` again.",
								].join("\n"),
							),
						),
				],
			});
		}

		await interaction.editReply({
			components: [
				new ContainerBuilder()
					.setAccentColor(0x0a84ff)
					.addComponent(
						new TextDisplayBuilder().setContent(
							`## ${getEmoji("brain")} Reading <#${channelId}>`,
						),
					)
					.addComponent(
						new TextDisplayBuilder().setContent(
							[
								"Collected the channel history and preparing punishment reasons…",
								"-# This usually takes a few seconds.",
							].join("\n"),
						),
					),
			],
		});

		const reasons = await generatePreparedReasons(rulesText);
		const config = await getPunishmentConfig(guildId);

		await savePunishmentConfig(guildId, {
			...config,
			rulesChannelId: channelId,
			reasons,
			setUpAt: Date.now(),
		});

		const channelName = await fetchChannelName(channelId).catch(() => "rules channel");

		return interaction.editReply({
			components: [
				buildSetupResultContainer({
					guildName,
					rulesChannelId: channelId,
					channelName,
					reasonCount: reasons.length,
					config: { ...config, reasons },
				}),
			],
		});
	} catch (error) {
		console.error("[Kaeru] /punishment setup failed:", error);
		return interaction.editReply({
			components: [
				new ContainerBuilder()
					.setAccentColor(0xff5353)
					.addComponent(
						new TextDisplayBuilder().setContent(`## ${getEmoji("error")} Setup failed`),
					)
					.addComponent(
						new TextDisplayBuilder().setContent(
							[
								"Could not read the channel or prepare reasons.",
								"-# Check that I can view the channel and its history, then try again.",
							].join("\n"),
						),
					),
			],
		});
	}
}

async function handlePunish(
	interaction: CommandInteraction,
	moderatorId: string,
	guildId: string,
) {
	const target = interaction.options.getUser("user", true)?.user;
	if (!target) {
		return sendAlertMessage({
			interaction,
			content: "Could not resolve the member to punish.",
			type: "error",
		});
	}

	if (target.id === moderatorId) {
		return sendAlertMessage({
			interaction,
			content: "You cannot punish yourself.",
			type: "error",
		});
	}

	if (target.bot) {
		return sendAlertMessage({
			interaction,
			content: "Bots cannot be punished with this command.",
			type: "error",
		});
	}

	const reasonInput = interaction.options.getString("reason")?.trim() ?? "";
	const durationInput = interaction.options.getString("duration")?.trim() ?? "";
	const actionInput = interaction.options.getString("action")?.trim() ?? "auto";

	let durationMs: number | null = null;
	if (durationInput) {
		durationMs = parseDurationInput(durationInput);
		if (durationMs === null) {
			return sendAlertMessage({
				interaction,
				content: `Invalid duration: **${durationInput}**\n\nAccepted formats: \`30s\`, \`30m\`, \`12h\`, \`7d\`, \`1w\``,
				type: "error",
			});
		}
	}

	await interaction.deferReply({
		flags: [InteractionFlags.Ephemeral, InteractionFlags.IsComponentsV2],
	});

	const config = await getPunishmentConfig(guildId);
	const prepared = findPreparedReason(config, reasonInput);
	// A reason id from autocomplete resolves to a prepared reason; anything else
	// is treated as a free-text reason written by the moderator.
	const reason = prepared
		? prepared.detail
			? `${prepared.title} — ${prepared.detail}`
			: prepared.title
		: reasonInput || "No reason provided";

	const outcome = await applyPunishmentCase({
		guildId,
		targetUserId: target.id,
		moderatorId,
		reason,
		reasonId: prepared?.id,
		requestedAction: actionInput as PunishmentAction | "auto",
		requestedDurationMs: durationMs,
		channelId: interaction.channel?.id ?? null,
	});

	if (!outcome.ok || !outcome.plan || !outcome.record || !outcome.config) {
		return interaction.editReply({
			components: [
				buildPunishmentFailureContainer({
					targetUserId: target.id,
					reason,
					error: outcome.error ?? "The punishment could not be applied.",
				}),
			],
		});
	}

	return interaction.editReply({
		components: [
			buildPunishmentResultContainer({
				targetUserId: target.id,
				plan: outcome.plan,
				reason,
				score: outcome.plan.scoreAfter,
				config: outcome.config,
				record: outcome.record,
				dmSent: outcome.dmSent ?? false,
				guildName: outcome.guildName ?? "this server",
			}),
		],
	});
}

async function handleView(interaction: CommandInteraction, guildId: string) {
	const target = interaction.options.getUser("user", true)?.user;
	if (!target) {
		return sendAlertMessage({
			interaction,
			content: "Could not resolve that member.",
			type: "error",
		});
	}

	await interaction.deferReply({
		flags: [InteractionFlags.Ephemeral, InteractionFlags.IsComponentsV2],
	});

	const config = await getPunishmentConfig(guildId);
	const record = await getPunishmentRecord(guildId, target.id);
	const member = await fetchGuildMember(guildId, target.id);
	const guild = await fetchGuild(guildId).catch(() => null);
	const guildName = typeof guild?.name === "string" ? guild.name : "this server";
	const avatar = typeof member?.avatar === "string" ? member.avatar : null;
	const nickname = typeof member?.nick === "string" ? member.nick : null;

	const targetTag = nickname ?? target.global_name ?? target.username;

	return interaction.editReply({
		components: [
			buildMemberRecordContainer({
				guildName,
				guildId,
				targetUserId: target.id,
				targetTag,
				avatarUrl: buildAvatarUrl(guildId, target.id, avatar),
				record,
				config,
			}),
		],
	});
}

async function handleForgive(
	interaction: CommandInteraction,
	moderatorId: string,
	guildId: string,
) {
	const target = interaction.options.getUser("user", true)?.user;
	if (!target) {
		return sendAlertMessage({
			interaction,
			content: "Could not resolve that member.",
			type: "error",
		});
	}

	await interaction.deferReply({
		flags: [InteractionFlags.Ephemeral, InteractionFlags.IsComponentsV2],
	});

	const config = await getPunishmentConfig(guildId);
	const record = await getPunishmentRecord(guildId, target.id);
	const caseInput = interaction.options.getString("case")?.trim() ?? "";

	let forgivenCases = record.cases.filter((punishmentCase) => !isForgiven(punishmentCase));
	if (caseInput) {
		const exact = record.cases.find(
			(punishmentCase) => punishmentCase.id === caseInput && !isForgiven(punishmentCase),
		);
		forgivenCases = exact ? [exact] : [];
	}

	if (forgivenCases.length === 0) {
		return interaction.editReply({
			components: [
				new ContainerBuilder()
					.setAccentColor(0xfaa61a)
					.addComponent(
						new TextDisplayBuilder().setContent(
							`## ${getEmoji("info")} Nothing to forgive`,
						),
					)
					.addComponent(
						new TextDisplayBuilder().setContent(
							`<@${target.id}> has no active punishment cases to remove.`,
						),
					),
			],
		});
	}

	const forgivenIds = new Set(forgivenCases.map((punishmentCase) => punishmentCase.id));
	const now = Date.now();
	const cases = record.cases.map((punishmentCase) =>
		forgivenIds.has(punishmentCase.id)
			? { ...punishmentCase, forgivenAt: now, forgivenBy: moderatorId }
			: punishmentCase,
	);
	const removedPoints = forgivenCases.reduce(
		(total, punishmentCase) => total + (punishmentCase.points ?? 0),
		0,
	);
	const updatedRecord = {
		...record,
		cases,
		score: Math.max(0, record.score - removedPoints),
		updatedAt: now,
	};

	await savePunishmentRecord(updatedRecord);

	// A member that dropped under the ban threshold should not stay banned.
	if (updatedRecord.score < config.banThreshold) {
		await removeBan({ guildId, targetUserId: target.id }).catch(() => {
			console.warn(`[Kaeru] No active ban to lift for ${target.id}.`);
		});
	}

	const guild = await fetchGuild(guildId).catch(() => null);
	const guildName = typeof guild?.name === "string" ? guild.name : "this server";

	await logPunishment({
		guildId,
		container: new ContainerBuilder()
			.setAccentColor(0x2ecc71)
			.addComponent(
				new TextDisplayBuilder().setContent(
					`## ${getEmoji("seal")} Punishment forgiven`,
				),
			)
			.addComponent(
				new TextDisplayBuilder().setContent(
					[
						`- **User:** <@${target.id}>`,
						`- **Moderator:** <@${moderatorId}>`,
						`- **Server:** ${guildName}`,
						`- **Cases cleared:** ${forgivenCases.length}`,
						`- **Points removed:** ${removedPoints}`,
						`- **New score:** ${updatedRecord.score} / ${config.banThreshold}`,
						`-# Cases: ${forgivenCases.map((punishmentCase) => `\`${punishmentCase.id}\``).join(", ")}`,
					].join("\n"),
				),
			)
			.addComponent(
				new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small),
			)
			.addComponent(
				new TextDisplayBuilder().setContent(
					`-# ${getEmoji("info")} Remaining active cases: ${countActiveCases(updatedRecord)}`,
				),
			),
	});

	return interaction.editReply({
		components: [
			buildForgiveResultContainer({
				targetUserId: target.id,
				forgivenCount: forgivenCases.length,
				removedPoints,
				record: updatedRecord,
				config,
			}),
		],
	});
}

/**
 * Autocomplete choices for `/punishment member reason` and
 * `/punishment forgive case`, wired up in `api/interactions.ts`.
 */
export async function getPunishmentAutocompleteChoices({
	guildId,
	userId,
	optionName,
	query,
}: {
	guildId: string | null;
	userId: string | null;
	optionName: string;
	query: string;
}) {
	if (!guildId) return [];

	if (optionName === "case" && userId) {
		const record = await getPunishmentRecord(guildId, userId);
		return buildCaseChoices(record, query);
	}

	const config = await getPunishmentConfig(guildId);
	return buildReasonChoices(config, query);
}