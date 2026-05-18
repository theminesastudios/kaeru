import { ChannelType, MiniPermFlags } from "@minesa-org/mini-interaction";
import { db } from "./database.ts";
import { fetchDiscord } from "./discord.ts";

const CUSTOM_VOICE_INDEX_KEY = "customVoice:index";
const CUSTOM_VOICE_CONFIG_PREFIX = "customVoiceConfig:";
const CUSTOM_VOICE_RECORD_PREFIX = "customVoice:";
const CUSTOM_VOICE_OWNER_PREFIX = "customVoiceOwner:";

const OWNER_CHANNEL_PERMISSIONS =
	MiniPermFlags.ViewChannel |
	MiniPermFlags.Connect |
	MiniPermFlags.Speak |
	MiniPermFlags.Stream |
	MiniPermFlags.UseVAD |
	MiniPermFlags.ManageChannels |
	MiniPermFlags.ManageRoles |
	MiniPermFlags.MoveMembers |
	MiniPermFlags.MuteMembers;

const INVITED_USER_PERMISSIONS =
	MiniPermFlags.ViewChannel |
	MiniPermFlags.Connect |
	MiniPermFlags.Speak |
	MiniPermFlags.Stream |
	MiniPermFlags.UseVAD;

export const CUSTOM_VOICE_BOT_PERMISSIONS =
	MiniPermFlags.ManageChannels | MiniPermFlags.MoveMembers | MiniPermFlags.ManageRoles;

export type CustomVoiceConfig = {
	guildId: string;
	categoryId: string | null;
	updatedAt: number;
};

export type CustomVoiceRecord = {
	channelId: string;
	guildId: string;
	ownerId: string;
	ownerName: string | null;
	name: string;
	parentId: string | null;
	sourceChannelId: string | null;
	userLimit: number;
	locked: boolean;
	createdAt: number;
	updatedAt: number;
};

type CustomVoiceIndexEntry = {
	channelId: string;
	guildId: string;
	ownerId: string;
};

type CustomVoiceIndex = {
	entries: CustomVoiceIndexEntry[];
	updatedAt: number;
};

type DiscordVoiceState = {
	channel_id?: string | null;
};

type DiscordChannel = {
	id: string;
	type: number;
	name?: string;
	parent_id?: string | null;
	permission_overwrites?: DiscordOverwrite[];
};

type DiscordOverwrite = {
	id: string;
	type: 0 | 1;
	allow: string;
	deny: string;
};

export type CustomVoiceCleanupResult = {
	checked: number;
	deleted: number;
	staleRecords: number;
	errors: string[];
};

export function hasPermissionBits(rawPermissions: string | number | bigint | null | undefined, required: bigint) {
	if (rawPermissions === null || rawPermissions === undefined || rawPermissions === "") {
		return false;
	}

	try {
		const permissions = BigInt(rawPermissions);
		return (permissions & required) === required;
	} catch {
		return false;
	}
}

export function isDiscordStatus(error: unknown, status: number) {
	return error instanceof Error && error.message.includes(`Discord API error: ${status} `);
}

export function normalizeVoiceName(input: string | null | undefined, fallback: string) {
	const stripped = (input ?? "")
		.replace(/[\r\n\t]/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	if (!stripped) {
		return fallback.slice(0, 100);
	}

	return stripped.slice(0, 100);
}

export function normalizeUserLimit(input: number | null | undefined) {
	if (typeof input !== "number" || Number.isNaN(input)) {
		return 0;
	}

	return Math.max(0, Math.min(99, Math.trunc(input)));
}

export async function getCustomVoiceConfig(guildId: string): Promise<CustomVoiceConfig | null> {
	const data = await db.get(`${CUSTOM_VOICE_CONFIG_PREFIX}${guildId}`);
	return normalizeConfig(data);
}

export async function setCustomVoiceCategory(guildId: string, categoryId: string | null) {
	const config: CustomVoiceConfig = {
		guildId,
		categoryId,
		updatedAt: Date.now(),
	};

	await setDbRecord(`${CUSTOM_VOICE_CONFIG_PREFIX}${guildId}`, config);
	return config;
}

export async function getUserVoiceState(guildId: string, userId: string): Promise<DiscordVoiceState | null> {
	try {
		return await fetchDiscord(
			`/guilds/${guildId}/voice-states/${userId}`,
			getBotToken(),
			true,
		) as DiscordVoiceState;
	} catch (error) {
		if (isDiscordStatus(error, 404)) {
			return null;
		}
		throw error;
	}
}

export async function createCustomVoiceChannel(params: {
	guildId: string;
	ownerId: string;
	ownerName?: string | null;
	name: string;
	parentId?: string | null;
	sourceChannelId?: string | null;
	userLimit: number;
	locked: boolean;
}) {
	const now = Date.now();
	const channel = await fetchDiscord(
		`/guilds/${params.guildId}/channels`,
		getBotToken(),
		true,
		"POST",
		{
			name: params.name,
			type: ChannelType.GuildVoice,
			parent_id: params.parentId ?? undefined,
			user_limit: params.userLimit,
			permission_overwrites: buildInitialOverwrites(params.guildId, params.ownerId, params.locked),
		},
	) as DiscordChannel;

	const record: CustomVoiceRecord = {
		channelId: channel.id,
		guildId: params.guildId,
		ownerId: params.ownerId,
		ownerName: params.ownerName ?? null,
		name: channel.name ?? params.name,
		parentId: params.parentId ?? null,
		sourceChannelId: params.sourceChannelId ?? null,
		userLimit: params.userLimit,
		locked: params.locked,
		createdAt: now,
		updatedAt: now,
	};

	try {
		await Promise.all([
			setDbRecord(recordKey(record.channelId), record),
			setDbRecord(ownerKey(record.guildId, record.ownerId), {
				channelId: record.channelId,
				guildId: record.guildId,
				ownerId: record.ownerId,
				updatedAt: now,
			}),
			upsertIndexEntry(record),
		]);
	} catch (error) {
		await deleteDiscordChannelIfPresent(record.channelId).catch((deleteError) => {
			console.error("[Kaeru] Failed to clean up custom voice channel after DB save failure:", deleteError);
		});
		await Promise.allSettled([
			db.delete(recordKey(record.channelId)),
			db.delete(ownerKey(record.guildId, record.ownerId)),
			removeIndexEntry(record.channelId),
		]);
		throw error;
	}

	return record;
}

export async function moveUserToVoiceChannel(guildId: string, userId: string, channelId: string) {
	await fetchDiscord(
		`/guilds/${guildId}/members/${userId}`,
		getBotToken(),
		true,
		"PATCH",
		{ channel_id: channelId },
	);
}

export async function getCustomVoiceRecord(channelId: string): Promise<CustomVoiceRecord | null> {
	const data = await db.get(recordKey(channelId));
	return normalizeRecord(data);
}

export async function getOwnedCustomVoiceRecord(guildId: string, ownerId: string) {
	const ownerData = await db.get(ownerKey(guildId, ownerId));
	const channelId = typeof ownerData?.channelId === "string" ? ownerData.channelId : null;
	if (!channelId) {
		return null;
	}

	return getCustomVoiceRecord(channelId);
}

export async function getCurrentCustomVoiceRecord(guildId: string, userId: string) {
	const voiceState = await getUserVoiceState(guildId, userId);
	const channelId = voiceState?.channel_id;
	if (!channelId) {
		return null;
	}

	return getCustomVoiceRecord(channelId);
}

export async function updateCustomVoiceName(record: CustomVoiceRecord, name: string) {
	await fetchDiscord(
		`/channels/${record.channelId}`,
		getBotToken(),
		true,
		"PATCH",
		{ name },
	);

	return updateRecord(record, { name });
}

export async function updateCustomVoiceLimit(record: CustomVoiceRecord, userLimit: number) {
	await fetchDiscord(
		`/channels/${record.channelId}`,
		getBotToken(),
		true,
		"PATCH",
		{ user_limit: userLimit },
	);

	return updateRecord(record, { userLimit });
}

export async function setCustomVoiceLocked(record: CustomVoiceRecord, locked: boolean) {
	const channel = await fetchDiscord(
		`/channels/${record.channelId}`,
		getBotToken(),
		true,
	) as DiscordChannel;

	const permission_overwrites = setEveryoneConnectOverride(
		channel.permission_overwrites ?? [],
		record.guildId,
		locked,
	);

	await fetchDiscord(
		`/channels/${record.channelId}`,
		getBotToken(),
		true,
		"PATCH",
		{ permission_overwrites },
	);

	return updateRecord(record, { locked });
}

export async function inviteUserToCustomVoice(record: CustomVoiceRecord, userId: string) {
	await fetchDiscord(
		`/channels/${record.channelId}/permissions/${userId}`,
		getBotToken(),
		true,
		"PUT",
		{
			type: 1,
			allow: INVITED_USER_PERMISSIONS.toString(),
			deny: "0",
		},
	);
}

export async function deleteCustomVoiceRecord(record: CustomVoiceRecord, deleteDiscordChannel = true) {
	if (deleteDiscordChannel) {
		await deleteDiscordChannelIfPresent(record.channelId);
	}

	await Promise.all([
		db.delete(recordKey(record.channelId)),
		db.delete(ownerKey(record.guildId, record.ownerId)),
		removeIndexEntry(record.channelId),
	]);
}

export async function cleanupCustomVoiceChannels(options: {
	guildId?: string;
	channelIds?: string[];
} = {}): Promise<CustomVoiceCleanupResult> {
	const index = await readIndex();
	const allowedChannelIds = options.channelIds ? new Set(options.channelIds) : null;
	const entries = index.entries.filter((entry) => {
		if (options.guildId && entry.guildId !== options.guildId) {
			return false;
		}
		if (allowedChannelIds && !allowedChannelIds.has(entry.channelId)) {
			return false;
		}
		return true;
	});

	const result: CustomVoiceCleanupResult = {
		checked: 0,
		deleted: 0,
		staleRecords: 0,
		errors: [],
	};

	for (const entry of entries) {
		result.checked += 1;

		try {
			const record = await getCustomVoiceRecord(entry.channelId);
			if (!record) {
				await removeIndexEntry(entry.channelId);
				result.staleRecords += 1;
				continue;
			}

			const voiceState = await getUserVoiceState(record.guildId, record.ownerId);
			if (voiceState?.channel_id === record.channelId) {
				continue;
			}

			await deleteCustomVoiceRecord(record, true);
			result.deleted += 1;
		} catch (error) {
			result.errors.push(error instanceof Error ? error.message : String(error));
		}
	}

	return result;
}

export async function resolveCustomVoiceParentId(guildId: string, sourceVoiceChannelId: string) {
	const config = await getCustomVoiceConfig(guildId);
	if (config?.categoryId) {
		return config.categoryId;
	}

	const sourceChannel = await fetchDiscord(
		`/channels/${sourceVoiceChannelId}`,
		getBotToken(),
		true,
	) as DiscordChannel;

	return sourceChannel.parent_id ?? null;
}

function getBotToken() {
	const token = (process.env.DISCORD_BOT_TOKEN ?? process.env.DISCORD_TOKEN)?.trim();
	if (!token) {
		throw new Error("DISCORD_BOT_TOKEN or DISCORD_TOKEN is not configured.");
	}

	return token;
}

function recordKey(channelId: string) {
	return `${CUSTOM_VOICE_RECORD_PREFIX}${channelId}`;
}

function ownerKey(guildId: string, ownerId: string) {
	return `${CUSTOM_VOICE_OWNER_PREFIX}${guildId}:${ownerId}`;
}

function normalizeConfig(data: Record<string, unknown> | null): CustomVoiceConfig | null {
	if (!data || typeof data.guildId !== "string") {
		return null;
	}

	return {
		guildId: data.guildId,
		categoryId: typeof data.categoryId === "string" ? data.categoryId : null,
		updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : Date.now(),
	};
}

function normalizeRecord(data: Record<string, unknown> | null): CustomVoiceRecord | null {
	if (
		!data ||
		typeof data.channelId !== "string" ||
		typeof data.guildId !== "string" ||
		typeof data.ownerId !== "string"
	) {
		return null;
	}

	return {
		channelId: data.channelId,
		guildId: data.guildId,
		ownerId: data.ownerId,
		ownerName: typeof data.ownerName === "string" ? data.ownerName : null,
		name: typeof data.name === "string" ? data.name : "Custom Voice",
		parentId: typeof data.parentId === "string" ? data.parentId : null,
		sourceChannelId: typeof data.sourceChannelId === "string" ? data.sourceChannelId : null,
		userLimit: typeof data.userLimit === "number" ? data.userLimit : 0,
		locked: data.locked === true,
		createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
		updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : Date.now(),
	};
}

async function updateRecord(record: CustomVoiceRecord, updates: Partial<CustomVoiceRecord>) {
	const updatedRecord: CustomVoiceRecord = {
		...record,
		...updates,
		updatedAt: Date.now(),
	};

	await setDbRecord(recordKey(record.channelId), updatedRecord);
	return updatedRecord;
}

function buildInitialOverwrites(guildId: string, ownerId: string, locked: boolean) {
	const overwrites: DiscordOverwrite[] = [
		{
			id: ownerId,
			type: 1,
			allow: OWNER_CHANNEL_PERMISSIONS.toString(),
			deny: "0",
		},
	];

	if (locked) {
		overwrites.unshift({
			id: guildId,
			type: 0,
			allow: "0",
			deny: MiniPermFlags.Connect.toString(),
		});
	}

	return overwrites;
}

function setEveryoneConnectOverride(
	overwrites: DiscordOverwrite[],
	guildId: string,
	locked: boolean,
) {
	const connectBit = MiniPermFlags.Connect;
	const nextOverwrites = overwrites.filter((overwrite) => !(overwrite.id === guildId && overwrite.type === 0));
	const existing = overwrites.find((overwrite) => overwrite.id === guildId && overwrite.type === 0);
	const allow = parsePermissionBits(existing?.allow);
	let deny = parsePermissionBits(existing?.deny);

	if (locked) {
		deny |= connectBit;
	} else {
		deny &= ~connectBit;
	}

	if (allow !== 0n || deny !== 0n) {
		nextOverwrites.push({
			id: guildId,
			type: 0,
			allow: allow.toString(),
			deny: deny.toString(),
		});
	}

	return nextOverwrites;
}

function parsePermissionBits(value: string | undefined) {
	if (!value) {
		return 0n;
	}

	try {
		return BigInt(value);
	} catch {
		return 0n;
	}
}

async function deleteDiscordChannelIfPresent(channelId: string) {
	try {
		await fetchDiscord(`/channels/${channelId}`, getBotToken(), true, "DELETE");
	} catch (error) {
		if (!isDiscordStatus(error, 404)) {
			throw error;
		}
	}
}

async function readIndex(): Promise<CustomVoiceIndex> {
	const data = await db.get(CUSTOM_VOICE_INDEX_KEY);
	const entries = Array.isArray(data?.entries)
		? data.entries.flatMap((entry) => normalizeIndexEntry(entry))
		: [];

	return {
		entries: dedupeIndexEntries(entries),
		updatedAt: typeof data?.updatedAt === "number" ? data.updatedAt : Date.now(),
	};
}

async function writeIndex(entries: CustomVoiceIndexEntry[]) {
	await setDbRecord(CUSTOM_VOICE_INDEX_KEY, {
		entries: dedupeIndexEntries(entries),
		updatedAt: Date.now(),
	});
}

async function setDbRecord(key: string, data: Record<string, unknown>) {
	const saved = await db.set(key, data);
	if (!saved) {
		throw new Error(`Failed to save database record "${key}".`);
	}
}

async function upsertIndexEntry(record: CustomVoiceRecord) {
	const index = await readIndex();
	await writeIndex([
		...index.entries.filter((entry) => entry.channelId !== record.channelId),
		{
			channelId: record.channelId,
			guildId: record.guildId,
			ownerId: record.ownerId,
		},
	]);
}

async function removeIndexEntry(channelId: string) {
	const index = await readIndex();
	await writeIndex(index.entries.filter((entry) => entry.channelId !== channelId));
}

function normalizeIndexEntry(entry: unknown): CustomVoiceIndexEntry[] {
	if (
		typeof entry === "object" &&
		entry !== null &&
		"channelId" in entry &&
		"guildId" in entry &&
		"ownerId" in entry &&
		typeof entry.channelId === "string" &&
		typeof entry.guildId === "string" &&
		typeof entry.ownerId === "string"
	) {
		return [
			{
				channelId: entry.channelId,
				guildId: entry.guildId,
				ownerId: entry.ownerId,
			},
		];
	}

	return [];
}

function dedupeIndexEntries(entries: CustomVoiceIndexEntry[]) {
	const seen = new Set<string>();
	const deduped: CustomVoiceIndexEntry[] = [];

	for (const entry of entries) {
		if (seen.has(entry.channelId)) {
			continue;
		}

		seen.add(entry.channelId);
		deduped.push(entry);
	}

	return deduped;
}
