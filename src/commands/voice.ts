import {
	ChannelType,
	CommandBuilder,
	CommandContext,
	IntegrationType,
	InteractionFlags,
	type CommandInteraction,
	type InteractionCommand,
	MiniPermFlags,
} from "@minesa-org/mini-interaction";
import {
	CUSTOM_VOICE_BOT_PERMISSIONS,
	cleanupCustomVoiceChannels,
	createCustomVoiceChannel,
	deleteCustomVoiceRecord,
	getCurrentCustomVoiceRecord,
	getOwnedCustomVoiceRecord,
	getUserVoiceState,
	hasPermissionBits,
	inviteUserToCustomVoice,
	moveUserToVoiceChannel,
	normalizeUserLimit,
	normalizeVoiceName,
	resolveCustomVoiceParentId,
	setCustomVoiceCategory,
	setCustomVoiceLocked,
	updateCustomVoiceLimit,
	updateCustomVoiceName,
	type CustomVoiceRecord,
} from "../utils/customVoice.ts";
import { getEmoji } from "../utils/index.ts";

const voiceCommand: InteractionCommand = {
	data: new CommandBuilder()
		.setName("voice")
		.setDescription("Create and manage temporary voice channels")
		.setContexts([CommandContext.Guild])
		.setIntegrationTypes([IntegrationType.GuildInstall])
		.addSubcommand((sub) =>
			sub
				.setName("create")
				.setDescription("Create your own temporary voice channel")
				.addStringOption((option) =>
					option
						.setName("name")
						.setDescription("Channel name")
						.setRequired(false)
						.setMinLength(1)
						.setMaxLength(100),
				)
				.addNumberOption((option) =>
					option
						.setName("limit")
						.setDescription("User limit, or 0 for unlimited")
						.setRequired(false)
						.setMinValue(0)
						.setMaxValue(99),
				)
				.addStringOption((option) =>
					option
						.setName("visibility")
						.setDescription("Whether everyone can join at first")
						.setRequired(false)
						.addChoice("Public", "public")
						.addChoice("Private", "private"),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("rename")
				.setDescription("Rename your temporary voice channel")
				.addStringOption((option) =>
					option
						.setName("name")
						.setDescription("New channel name")
						.setRequired(true)
						.setMinLength(1)
						.setMaxLength(100),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("limit")
				.setDescription("Set your temporary voice channel user limit")
				.addNumberOption((option) =>
					option
						.setName("limit")
						.setDescription("User limit, or 0 for unlimited")
						.setRequired(true)
						.setMinValue(0)
						.setMaxValue(99),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("lock")
				.setDescription("Stop everyone from joining your temporary voice channel"),
		)
		.addSubcommand((sub) =>
			sub
				.setName("unlock")
				.setDescription("Let everyone join your temporary voice channel"),
		)
		.addSubcommand((sub) =>
			sub
				.setName("invite")
				.setDescription("Allow a user to join your temporary voice channel")
				.addUserOption((option) =>
					option
						.setName("user")
						.setDescription("User to invite")
						.setRequired(true),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("delete")
				.setDescription("Delete your temporary voice channel now"),
		)
		.addSubcommand((sub) =>
			sub
				.setName("status")
				.setDescription("Show your temporary voice channel status"),
		)
		.addSubcommand((sub) =>
			sub
				.setName("setup")
				.setDescription("Set the category used for new temporary voice channels")
				.addChannelOption((option) =>
					option
						.setName("category")
						.setDescription("Category for temporary voice channels")
						.setRequired(false)
						.addChannelTypes(ChannelType.GuildCategory),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("cleanup")
				.setDescription("Delete stale temporary voice channels now"),
		),

	handler: async (interaction: CommandInteraction) => {
		const user = interaction.user ?? interaction.member?.user;
		const guildId = interaction.guild_id;

		if (!guildId || !user) {
			return interaction.reply({
				content: `${getEmoji("error")} This command can only be used in a server.`,
				flags: InteractionFlags.Ephemeral,
			});
		}

		await interaction.deferReply({ flags: InteractionFlags.Ephemeral });

		if (!hasPermissionBits(interaction.app_permissions, CUSTOM_VOICE_BOT_PERMISSIONS)) {
			return interaction.editReply({
				content:
					`${getEmoji("error")} I need **Manage Channels**, **Manage Roles**, and **Move Members** to run temporary voice rooms.`,
			});
		}

		const subcommand = interaction.options.getSubcommand();

		try {
			if (subcommand === "setup") {
				return handleSetup(interaction, guildId);
			}

			if (subcommand === "cleanup") {
				return handleCleanup(interaction, guildId);
			}

			if (subcommand === "create") {
				return handleCreate(interaction, guildId, user);
			}

			if (subcommand === "rename") {
				const record = await requireOwnedRoom(interaction, guildId, user.id, true);
				if (!record) return;

				const requestedName = interaction.options.getString("name", true);
				const name = normalizeVoiceName(requestedName, record.name);
				const updated = await updateCustomVoiceName(record, name);

				return interaction.editReply({
					content: `${getEmoji("seal")} Renamed your voice room to <#${updated.channelId}>.`,
				});
			}

			if (subcommand === "limit") {
				const record = await requireOwnedRoom(interaction, guildId, user.id, true);
				if (!record) return;

				const userLimit = normalizeUserLimit(interaction.options.getNumber("limit", true));
				await updateCustomVoiceLimit(record, userLimit);

				return interaction.editReply({
					content: `${getEmoji("seal")} Set <#${record.channelId}> limit to **${userLimit || "unlimited"}**.`,
				});
			}

			if (subcommand === "lock" || subcommand === "unlock") {
				const record = await requireOwnedRoom(interaction, guildId, user.id, true);
				if (!record) return;

				const locked = subcommand === "lock";
				await setCustomVoiceLocked(record, locked);

				return interaction.editReply({
					content: `${getEmoji("seal")} ${locked ? "Locked" : "Unlocked"} <#${record.channelId}>.`,
				});
			}

			if (subcommand === "invite") {
				const record = await requireOwnedRoom(interaction, guildId, user.id, true);
				if (!record) return;

				const target = interaction.options.getUser("user", true);
				if (!target) {
					return interaction.editReply({
						content: `${getEmoji("error")} Please choose a user to invite.`,
					});
				}

				await inviteUserToCustomVoice(record, target.user.id);

				return interaction.editReply({
					content: `${getEmoji("seal")} <@${target.user.id}> can now join <#${record.channelId}>.`,
				});
			}

			if (subcommand === "delete") {
				const record = await requireOwnedRoom(interaction, guildId, user.id, false);
				if (!record) return;

				await deleteCustomVoiceRecord(record, true);

				return interaction.editReply({
					content: `${getEmoji("seal")} Deleted your temporary voice channel.`,
				});
			}

			if (subcommand === "status") {
				const record = await getOwnedCustomVoiceRecord(guildId, user.id);
				if (!record) {
					return interaction.editReply({
						content: "You do not own a temporary voice channel right now.",
					});
				}

				const voiceState = await getUserVoiceState(guildId, user.id);
				if (voiceState?.channel_id !== record.channelId) {
					await deleteCustomVoiceRecord(record, true);
					return interaction.editReply({
						content: "Your temporary voice channel was stale, so I cleaned it up.",
					});
				}

				return interaction.editReply({
					content:
						`## ${getEmoji("people")} Temporary Voice\n` +
						`- Channel: <#${record.channelId}>\n` +
						`- Limit: ${record.userLimit || "unlimited"}\n` +
						`- Visibility: ${record.locked ? "locked" : "public"}`,
				});
			}
		} catch (error) {
			console.error("[Kaeru] /voice failed:", error);
			return interaction.editReply({
				content:
					`${getEmoji("error")} I could not complete that voice action. Check my channel permissions and try again.`,
			});
		}
	},
};

async function handleCreate(interaction: CommandInteraction, guildId: string, user: { id: string; username?: string }) {
	const existing = await getOwnedCustomVoiceRecord(guildId, user.id);
	if (existing) {
		const cleanup = await cleanupCustomVoiceChannels({
			guildId,
			channelIds: [existing.channelId],
		});

		if (cleanup.deleted === 0) {
			return interaction.editReply({
				content: `You already own <#${existing.channelId}>. Use \`/voice delete\` first if you want a new room.`,
			});
		}
	}

	const voiceState = await getUserVoiceState(guildId, user.id);
	const sourceChannelId = voiceState?.channel_id;
	if (!sourceChannelId) {
		return interaction.editReply({
			content: "Join any voice channel first, then run `/voice create` again. I use that to place the new room and move you into it.",
		});
	}

	const defaultName = `${user.username ?? "User"}'s room`;
	const name = normalizeVoiceName(interaction.options.getString("name"), defaultName);
	const userLimit = normalizeUserLimit(interaction.options.getNumber("limit"));
	const locked = interaction.options.getString("visibility") === "private";
	const parentId = await resolveCustomVoiceParentId(guildId, sourceChannelId);

	const record = await createCustomVoiceChannel({
		guildId,
		ownerId: user.id,
		ownerName: user.username ?? null,
		name,
		parentId,
		sourceChannelId,
		userLimit,
		locked,
	});

	try {
		await moveUserToVoiceChannel(guildId, user.id, record.channelId);
	} catch (error) {
		await deleteCustomVoiceRecord(record, true).catch((deleteError) => {
			console.error("[Kaeru] Failed to clean up custom voice channel after move failure:", deleteError);
		});
		throw error;
	}

	return interaction.editReply({
		content:
			`${getEmoji("seal")} Created <#${record.channelId}> and moved you in.\n` +
			`You can edit it with Discord's channel settings or with \`/voice rename\`, \`/voice limit\`, \`/voice lock\`, \`/voice unlock\`, and \`/voice invite\`.`,
	});
}

async function handleSetup(interaction: CommandInteraction, guildId: string) {
	if (!hasPermissionBits(interaction.member?.permissions, MiniPermFlags.ManageChannels)) {
		return interaction.editReply({
			content: `${getEmoji("error")} You need **Manage Channels** to configure temporary voice rooms.`,
		});
	}

	const category = interaction.options.getChannel("category");
	const config = await setCustomVoiceCategory(guildId, category?.id ?? null);

	return interaction.editReply({
		content: config.categoryId
			? `${getEmoji("seal")} New temporary voice channels will be created under <#${config.categoryId}>.`
			: `${getEmoji("seal")} Cleared the temporary voice category. New rooms will copy the category of the voice channel the creator is in.`,
	});
}

async function handleCleanup(interaction: CommandInteraction, guildId: string) {
	if (!hasPermissionBits(interaction.member?.permissions, MiniPermFlags.ManageChannels)) {
		return interaction.editReply({
			content: `${getEmoji("error")} You need **Manage Channels** to clean up temporary voice rooms.`,
		});
	}

	const result = await cleanupCustomVoiceChannels({ guildId });

	return interaction.editReply({
		content:
			`${getEmoji("seal")} Checked **${result.checked}** temporary voice channel(s), deleted **${result.deleted}**, and pruned **${result.staleRecords}** stale record(s).`,
	});
}

async function requireOwnedRoom(
	interaction: CommandInteraction,
	guildId: string,
	userId: string,
	requireOwnerInside: boolean,
): Promise<CustomVoiceRecord | null> {
	const record = await getOwnedCustomVoiceRecord(guildId, userId);
	if (!record) {
		const currentRecord = await getCurrentCustomVoiceRecord(guildId, userId);
		if (currentRecord) {
			await interaction.editReply({
				content: `Only <@${currentRecord.ownerId}> can manage <#${currentRecord.channelId}>.`,
			});
			return null;
		}

		await interaction.editReply({
			content: "You do not own a temporary voice channel right now.",
		});
		return null;
	}

	if (requireOwnerInside) {
		const voiceState = await getUserVoiceState(guildId, userId);
		if (voiceState?.channel_id !== record.channelId) {
			await deleteCustomVoiceRecord(record, true);
			await interaction.editReply({
				content: "Your temporary voice channel was already stale, so I cleaned it up.",
			});
			return null;
		}
	}

	return record;
}

export default voiceCommand;
