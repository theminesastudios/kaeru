import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	TextDisplayBuilder,
} from "@minesa-org/mini-interaction";
import type { MessageActionRowComponent } from "@minesa-org/mini-interaction";
import { db } from "./database.ts";
import { DiscordApiError, fetchDiscord } from "./discord.ts";
import { getEmoji, getEmojiData } from "./emojis.ts";

export const TICKET_STATUS_SELECT_ID = "ticket-select-menu";
export const TICKET_CLAIM_BUTTON_ID = "ticket-claim";
export const TICKET_LOCK_BUTTON_ID = "ticket-lock-conversation";
export const TICKET_LOCK_REASON_SELECT_ID = "ticket-lock-reason";
export const TICKET_CLOSE_MODAL_ID = "ticket-close-modal";

export const TICKET_STATUS_DONE = "ticket-menu-done";
export const TICKET_STATUS_NOT_PLANNED = "ticket-menu-duplicate";
export const TICKET_STATUS_CLOSE_COMMENT = "ticket-menu-close";
export const TICKET_STATUS_REOPEN = "ticket-menu-reopen";

type TicketData = Record<string, any>;
const MAX_ACTIVE_TICKETS_PER_USER = 3;

function uniqueIds(ids: unknown[]) {
	return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

function normalizeStaffMember(member: any) {
	const userId = typeof member?.user?.id === "string" ? member.user.id : null;
	if (!userId) return null;

	return {
		userId,
		username: typeof member?.user?.username === "string" ? member.user.username : null,
		nick: typeof member?.nick === "string" ? member.nick : null,
		roles: Array.isArray(member?.roles) ? uniqueIds(member.roles) : [],
	};
}

export async function refreshStaffRoster(guildId: string, staffRoleId: string) {
	const members = await fetchDiscord(
		`/guilds/${guildId}/members?limit=1000`,
		process.env.DISCORD_BOT_TOKEN!,
		true,
		"GET",
		null,
		8000,
	).catch((error) => {
		console.warn("[Kaeru] Could not refresh guild members for ticket assignment:", error);
		return [];
	});

	const staffMembers = Array.isArray(members)
		? members
			.map(normalizeStaffMember)
			.filter(
				(member): member is NonNullable<ReturnType<typeof normalizeStaffMember>> =>
					member !== null && member.roles.includes(staffRoleId) && member.userId !== null,
			)
		: [];

	const roster = staffMembers.map((member) => ({
		userId: member.userId,
		username: member.username,
		nick: member.nick,
		snapshottedAt: Date.now(),
	}));

	await db.set(`staff-roster:${guildId}`, {
		staffRoleId,
		updatedAt: Date.now(),
		memberIds: roster.map((member) => member.userId),
		members: roster,
	}).catch((error) => {
		console.warn("[Kaeru] Could not save refreshed staff roster:", error);
	});

	return roster;
}

export async function getStoredStaffRoster(guildId: string, staffRoleId: string) {
	const rosterData = await db.get(`staff-roster:${guildId}`).catch(() => null);
	const storedRoleId = typeof rosterData?.staffRoleId === "string" ? rosterData.staffRoleId : null;
	const members = Array.isArray(rosterData?.members) ? rosterData.members : [];

	if (storedRoleId !== staffRoleId || members.length === 0) {
		return refreshStaffRoster(guildId, staffRoleId);
	}

	// Stored entries were already normalized + role-filtered at write time in
	// refreshStaffRoster ({userId, username, nick}). Re-running them through
	// normalizeStaffMember (which expects Discord's {user, roles} shape) dropped
	// every one to null. Just keep entries that have a userId.
	return members.filter(
		(member): member is { userId: string; username: string | null; nick: string | null } =>
			typeof member?.userId === "string" && member.userId.length > 0,
	);
}

export function buildTicketClaimButtonRow() {
	return new ActionRowBuilder<MessageActionRowComponent>().addComponents(
		new ButtonBuilder()
			.setCustomId(TICKET_CLAIM_BUTTON_ID)
			.setLabel("Claim Ticket")
			.setStyle(ButtonStyle.Secondary)
			.setEmoji(getEmojiData("people")),
	);
}

export function buildTicketManagementRows() {
	return [buildTicketClaimButtonRow()];
}

export function buildTicketManagementRowsJson() {
	return buildTicketManagementRows().map((row) => row.toJSON());
}

export function getInteractionUser(interaction: {
	user?: { id: string; username?: string };
	member?: { user?: { id: string; username?: string }; roles?: string[] };
}) {
	return interaction.user ?? interaction.member?.user ?? null;
}

// Discord already folds Administrator into the computed member permissions on
// interactions, so this single bit check covers admins too.
const MANAGE_THREADS = 1n << 34n;

function hasManageThreads(rawPermissions?: string) {
	if (!rawPermissions) return false;
	try {
		return (BigInt(rawPermissions) & MANAGE_THREADS) === MANAGE_THREADS;
	} catch {
		return false;
	}
}

export async function canUseTicketStaffControls(
	interaction: {
		guild_id?: string;
		user?: { id: string; username?: string };
		member?: {
			user?: { id: string; username?: string };
			roles?: string[];
			permissions?: string;
		};
	},
	ticketData: TicketData,
) {
	const guildData = await db.get(`guild:${ticketData.guildId}`).catch(() => null);
	const staffRoleId =
		typeof guildData?.pingRoleId === "string" ? guildData.pingRoleId : null;

	if (hasManageThreads(interaction.member?.permissions)) {
		return { ok: true, staffRoleId };
	}

	if (!staffRoleId) {
		return {
			ok: false,
			message: "No staff role is configured for this server. Set one with `/ticket setup` first.",
			staffRoleId: null,
		};
	}

	const roles = Array.isArray(interaction.member?.roles)
		? interaction.member.roles
		: [];

	if (roles.includes(staffRoleId)) {
		return { ok: true, staffRoleId };
	}

	const userId = getInteractionUser(interaction)?.id;
	if (interaction.guild_id && userId) {
		const member = await fetchDiscord(
			`/guilds/${interaction.guild_id}/members/${userId}`,
			process.env.DISCORD_BOT_TOKEN!,
			true,
			"GET",
			null,
			5000,
		).catch(() => null);

		if (Array.isArray(member?.roles) && member.roles.includes(staffRoleId)) {
			return { ok: true, staffRoleId };
		}
	}

	return {
		ok: false,
		message: `Only members of <@&${staffRoleId}> or users with **Manage Threads** can manage this ticket.`,
		staffRoleId,
	};
}

export function buildTicketLockReasonRow() {
	const menu = new StringSelectMenuBuilder()
		.setCustomId(TICKET_LOCK_REASON_SELECT_ID)
		.setPlaceholder("Choose a reason")
		.setMinValues(1)
		.setMaxValues(1)
		.addOptions(
			new StringSelectMenuOptionBuilder()
				.setLabel("Other")
				.setValue("ticket-lock-reason-other"),
			new StringSelectMenuOptionBuilder()
				.setLabel("Off-topic")
				.setValue("ticket-lock-reason-off-topic"),
			new StringSelectMenuOptionBuilder()
				.setLabel("Too heated")
				.setValue("ticket-lock-reason-too-heated"),
			new StringSelectMenuOptionBuilder()
				.setLabel("Resolved")
				.setValue("ticket-lock-reason-resolved"),
			new StringSelectMenuOptionBuilder()
				.setLabel("Spam")
				.setValue("ticket-lock-reason-spam"),
		);

	return new ActionRowBuilder<MessageActionRowComponent>().addComponents(menu);
}

export async function resolveTicketByThreadId(threadId: string) {
	const threadData = await db.get(`thread:${threadId}`);
	if (!threadData?.ticketId) {
		return { threadData: null, ticketData: null };
	}

	const ticketData = await db.get(`ticket:${threadData.ticketId}`);
	return { threadData, ticketData };
}

export function isTicketOpen(
	ticketData: TicketData | null | undefined,
): ticketData is TicketData {
	return ticketData?.status === "open";
}

export async function updateTicket(ticketData: TicketData, patch: TicketData) {
	const updatedTicket = {
		...ticketData,
		...patch,
		updatedAt: Date.now(),
	};
	await db.set(`ticket:${ticketData.ticketId}`, updatedTicket);
	return updatedTicket;
}

function uniqueTicketIds(ids: unknown[]) {
	return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

export function getStoredActiveTicketIds(userData: Record<string, any> | null | undefined) {
	return uniqueTicketIds([
		...(Array.isArray(userData?.activeTicketIds) ? userData.activeTicketIds : []),
		userData?.activeTicketId,
	]);
}

export async function getUserOpenTickets(userId: string) {
	const userData = await db.get(`user:${userId}`).catch(() => null);
	const ticketIds = getStoredActiveTicketIds(userData);
	const tickets = await Promise.all(
		ticketIds.map((ticketId) => db.get(`ticket:${ticketId}`).catch(() => null)),
	);
	const openTickets = tickets.filter(isTicketOpen);
	const openTicketIds = openTickets.map((ticket) => ticket.ticketId);
	const currentTicketId =
		typeof userData?.activeTicketId === "string" &&
		openTicketIds.includes(userData.activeTicketId)
			? userData.activeTicketId
			: openTicketIds[0] ?? null;

	if (
		userData &&
		(openTicketIds.length !== ticketIds.length || currentTicketId !== userData.activeTicketId)
	) {
		const updatedUserData: Record<string, any> = {
			...userData,
			activeTicketIds: openTicketIds,
			activeTicketId: currentTicketId,
		};
		delete updatedUserData.createdAt;
		delete updatedUserData.updatedAt;
		await db.set(`user:${userId}`, updatedUserData);
	}

	return { userData, tickets: openTickets, currentTicketId };
}

export async function validateTicketCreateLimit(userId: string, guildId: string) {
	const { tickets } = await getUserOpenTickets(userId);

	if (tickets.some((ticket) => ticket.guildId === guildId)) {
		return {
			ok: false,
			message:
				"You already have an active ticket in this server. Use `/switch-ticket` if you want to make it your current ticket.",
			tickets,
		};
	}

	if (tickets.length >= MAX_ACTIVE_TICKETS_PER_USER) {
		return {
			ok: false,
			message:
				`You can have up to ${MAX_ACTIVE_TICKETS_PER_USER} active tickets. Close one before creating another.`,
			tickets,
		};
	}

	return { ok: true, tickets };
}

export async function getActiveTicketAutocompleteChoices(
	userId: string,
	query: string,
) {
	const { tickets, currentTicketId } = await getUserOpenTickets(userId);
	const normalizedQuery = query.trim().toLowerCase();

	return tickets
		.filter((ticket) => {
			const label = formatTicketChoiceLabel(ticket, ticket.ticketId === currentTicketId);
			return label.toLowerCase().includes(normalizedQuery);
		})
		.slice(0, 25)
		.map((ticket) => ({
			name: formatTicketChoiceLabel(ticket, ticket.ticketId === currentTicketId),
			value: ticket.ticketId,
		}));
}

function formatTicketChoiceLabel(ticket: TicketData, isCurrent: boolean) {
	const caseLabel = ticket.caseNumber ? `#${ticket.caseNumber}` : ticket.ticketId;
	const title = typeof ticket.title === "string" ? ticket.title : "Ticket";
	const guildLabel =
		typeof ticket.guildName === "string" && ticket.guildName.length > 0
			? ` - ${ticket.guildName}`
			: "";
	const currentLabel = isCurrent ? " (current)" : "";

	return `${caseLabel} - ${title}${guildLabel}${currentLabel}`.slice(0, 100);
}

export async function addActiveTicketForUser({
	userId,
	guildId,
	ticketId,
	userTicketData,
}: {
	userId: string;
	guildId: string;
	ticketId: string;
	userTicketData?: Record<string, any> | null;
}) {
	const existingUserData =
		userTicketData ?? (await db.get(`user:${userId}`).catch(() => null));
	const activeTicketIds = uniqueTicketIds([
		...getStoredActiveTicketIds(existingUserData),
		ticketId,
	]);
	const updatedUserData: Record<string, any> = {
		...(existingUserData || {}),
		activeTicketIds,
		activeTicketId: ticketId,
		guildId,
	};
	delete updatedUserData.createdAt;
	delete updatedUserData.updatedAt;
	await db.set(`user:${userId}`, updatedUserData);
}

export async function setCurrentTicketForUser(userId: string, ticketId: string) {
	const userData = await db.get(`user:${userId}`).catch(() => null);
	const activeTicketIds = uniqueTicketIds([
		...getStoredActiveTicketIds(userData),
		ticketId,
	]);
	const updatedUserData: Record<string, any> = {
		...(userData || {}),
		activeTicketIds,
		activeTicketId: ticketId,
	};
	delete updatedUserData.createdAt;
	delete updatedUserData.updatedAt;
	await db.set(`user:${userId}`, updatedUserData);
}

export async function clearActiveTicket(ticketData: TicketData) {
	const userKey = `user:${ticketData.userId}`;
	const userData = await db.get(userKey).catch(() => null);

	if (!userData) {
		return;
	}

	const activeTicketIds = getStoredActiveTicketIds(userData).filter(
		(ticketId) => ticketId !== ticketData.ticketId,
	);
	const updatedUserData: Record<string, any> = {
		...userData,
		activeTicketIds,
		activeTicketId:
			userData.activeTicketId === ticketData.ticketId
				? activeTicketIds[0] ?? null
				: userData.activeTicketId ?? activeTicketIds[0] ?? null,
	};
	delete updatedUserData.createdAt;
	delete updatedUserData.updatedAt;
	await db.set(userKey, updatedUserData);
}

export async function restoreActiveTicket(ticketData: TicketData) {
	const userKey = `user:${ticketData.userId}`;
	const userData = await db.get(userKey).catch(() => null);
	const { tickets } = await getUserOpenTickets(ticketData.userId);
	const activeTicketId = tickets.find((ticket) => ticket.ticketId !== ticketData.ticketId)?.ticketId ?? null;

	if (activeTicketId && activeTicketId !== ticketData.ticketId) {
		const activeTicket = await db.get(`ticket:${activeTicketId}`).catch(() => null);
		if (isTicketOpen(activeTicket) && activeTicket.guildId === ticketData.guildId) {
			return {
				ok: false,
				message: `The user already has another open ticket: <#${activeTicket.threadId}>.`,
			};
		}
	}

	const updatedUserData: Record<string, any> = {
		...(userData || {}),
		activeTicketIds: uniqueTicketIds([
			...getStoredActiveTicketIds(userData),
			ticketData.ticketId,
		]),
		activeTicketId: ticketData.ticketId,
		guildId: ticketData.guildId,
	};
	delete updatedUserData.createdAt;
	delete updatedUserData.updatedAt;
	await db.set(userKey, updatedUserData);

	return { ok: true };
}

export async function patchThread(
	threadId: string,
	body: { locked?: boolean; archived?: boolean },
) {
	return fetchDiscord(
		`/channels/${threadId}`,
		process.env.DISCORD_BOT_TOKEN!,
		true,
		"PATCH",
		body,
	);
}

export async function addThreadMember(threadId: string, userId: string) {
	await fetchDiscord(
		`/channels/${threadId}/thread-members/${userId}`,
		process.env.DISCORD_BOT_TOKEN!,
		true,
		"PUT",
		null,
		5000,
	);

	// Remember who the bot pulled in. Discord's live member list cannot always be
	// read (see getThreadMemberIds), so this record is what still lets a later
	// claim clean the thread up.
	await trackThreadMembers(threadId, [userId]);
}

export async function removeThreadMember(threadId: string, userId: string) {
	await fetchDiscord(
		`/channels/${threadId}/thread-members/${userId}`,
		process.env.DISCORD_BOT_TOKEN!,
		true,
		"DELETE",
		null,
		5000,
	);
}

// The bot is a member of every private thread it creates, so it must never be
// removed from a ticket. Resolve it once per instance and cache the id.
let botUserIdPromise: Promise<string | null> | undefined;

export async function getBotUserId(): Promise<string | null> {
	if (!botUserIdPromise) {
		botUserIdPromise = fetchDiscord("/users/@me", process.env.DISCORD_BOT_TOKEN!, true)
			.then((user) => (typeof user?.id === "string" ? user.id : null))
			.catch((error) => {
				console.warn("[Kaeru] Could not resolve the bot user id:", error);
				botUserIdPromise = undefined;
				return null;
			});
	}

	return botUserIdPromise;
}

const THREAD_MEMBER_PAGE_SIZE = 100;
const THREAD_MEMBER_MAX_PAGES = 10;

function readThreadMemberPage(payload: any) {
	// API v10 without with_member returns a bare array; v11 (and v10 with
	// with_member=true) returns {members, has_more}. Accepting only the array
	// made every paginated response look like an unreadable thread.
	if (Array.isArray(payload)) {
		return { members: payload as any[], hasMore: false };
	}

	if (Array.isArray(payload?.members)) {
		return { members: payload.members as any[], hasMore: payload.has_more === true };
	}

	return null;
}

// Live source of truth for who is actually inside the thread. Returns null only
// when Discord could not be read; an empty array really does mean "no members".
export async function getThreadMemberIds(threadId: string): Promise<string[] | null> {
	const collected = new Set<string>();
	let after: string | null = null;

	for (let page = 0; page < THREAD_MEMBER_MAX_PAGES; page += 1) {
		const query = new URLSearchParams({ limit: String(THREAD_MEMBER_PAGE_SIZE) });
		if (after) {
			query.set("after", after);
		}

		const payload = await fetchDiscord(
			`/channels/${threadId}/thread-members?${query.toString()}`,
			process.env.DISCORD_BOT_TOKEN!,
			true,
			"GET",
			null,
			5000,
		).catch((error) => {
			// The most common cause is the GUILD_MEMBERS privileged intent being
			// off. Log it loudly: it is a setup problem, not a transient one.
			console.warn("[Kaeru] Could not fetch ticket thread members:", error);
			return null;
		});

		const parsed = payload === null ? null : readThreadMemberPage(payload);
		if (!parsed) {
			// Partially paginated results are worse than none: callers would treat
			// the first page as the whole thread.
			return collected.size > 0 ? [...collected] : null;
		}

		// The thread member object carries the thread id in `id` and the user id
		// in `user_id`, so `id` must never be preferred. `user_id` is absent in
		// some older payloads, which is the only reason `id` is still read.
		const pageIds = uniqueIds(
			parsed.members
				.map((member: any) => member?.user_id ?? member?.id)
				.filter((userId: string) => userId !== threadId),
		);

		const newIds = pageIds.filter((userId) => !collected.has(userId));
		newIds.forEach((userId) => collected.add(userId));

		// A bare array has no has_more flag, so keep going only while pages keep
		// returning members we have not seen yet.
		if (pageIds.length === 0 || newIds.length === 0) {
			break;
		}

		if (!parsed.hasMore && pageIds.length < THREAD_MEMBER_PAGE_SIZE) {
			break;
		}

		after = pageIds[pageIds.length - 1];
	}

	return [...collected];
}

// Members the bot added to this thread, as recorded on the thread document.
async function getTrackedThreadMemberIds(threadId: string): Promise<string[]> {
	const threadData = await db.get(`thread:${threadId}`).catch(() => null);
	return uniqueIds(Array.isArray(threadData?.memberIds) ? threadData.memberIds : []);
}

async function writeTrackedThreadMembers(threadId: string, memberIds: string[]) {
	const threadData = await db.get(`thread:${threadId}`).catch(() => null);

	// Never recreate a thread record: closing a ticket deletes it, and writing a
	// bare member list back would resurrect a closed thread as unresolvable.
	if (!threadData) {
		return;
	}

	await db
		.set(`thread:${threadId}`, { ...(threadData || {}), memberIds })
		.catch((error) => {
			console.warn(
				"[Kaeru] Could not persist tracked ticket thread members:",
				error,
			);
		});
}

export async function trackThreadMembers(threadId: string, userIds: string[]) {
	const additions = uniqueIds(userIds);
	if (additions.length === 0) {
		return;
	}

	const existing = await getTrackedThreadMemberIds(threadId);
	const next = uniqueIds([...existing, ...additions]);
	if (next.length === existing.length) {
		return;
	}

	await writeTrackedThreadMembers(threadId, next);
}

export async function getRandomStaffMember(guildId: string, staffRoleId: string) {
	const candidates = await getStoredStaffRoster(guildId, staffRoleId);

	if (candidates.length === 0) {
		return null;
	}

	return candidates[Math.floor(Math.random() * candidates.length)];
}

export async function assignRandomStaffMember({
	guildId,
	threadId,
	staffRoleId,
}: {
	guildId: string;
	threadId: string;
	staffRoleId?: string | null;
}) {
	if (!staffRoleId) {
		return null;
	}

	const member = await getRandomStaffMember(guildId, staffRoleId);
	const userId = member?.userId;

	if (!userId) {
		return null;
	}

	await addThreadMember(threadId, userId).catch((error) => {
		console.warn("[Kaeru] Could not add randomly assigned staff member:", error);
	});

	return {
		claimedById: userId,
		claimedByUsername: member.username ?? member.nick ?? "Assigned staff member",
		claimedAt: Date.now(),
		claimMode: "random",
	};
}

export async function claimTicketForStaff({
	ticketData,
	threadId,
	claimant,
}: {
	ticketData: TicketData;
	threadId: string;
	claimant: { id: string; username?: string };
}) {
	const guildData = await db.get(`guild:${ticketData.guildId}`).catch(() => null);
	const staffRoleId =
		typeof ticketData.staffRoleId === "string"
			? ticketData.staffRoleId
			: typeof guildData?.pingRoleId === "string"
				? guildData.pingRoleId
				: null;

	await addThreadMember(threadId, claimant.id);

	// Claiming hands the ticket over: everyone else that was sitting in the
	// thread (other staff, manually invited helpers, the previous claimant) is
	// dropped, while the claimant and the ticket creator stay.
	const { removedMemberIds, failedMemberIds } =
		await removeOtherStaffRoleMembersFromThread({
			guildId: ticketData.guildId,
			threadId,
			staffRoleId,
			keepUserIds: [claimant.id, ticketData.userId],
		});

	const ticket = await updateTicket(ticketData, {
		claimedById: claimant.id,
		claimedByUsername: claimant.username ?? null,
		claimedAt: Date.now(),
		claimMode: "manual",
	});

	return { ticket, removedMemberIds, failedMemberIds };
}

export async function removeOtherStaffRoleMembersFromThread({
	guildId,
	threadId,
	staffRoleId,
	keepUserIds,
}: {
	guildId: string;
	threadId: string;
	staffRoleId?: string | null;
	keepUserIds: (string | null | undefined)[];
}) {
	const keep = new Set(uniqueIds(keepUserIds));

	const botUserId = await getBotUserId();
	if (botUserId) {
		keep.add(botUserId);
	}

	// Every source is merged instead of picking one. A member can be missing
	// from any single one of them and still be sitting in the thread:
	// the staff roster is a stale snapshot, the tracked list only covers people
	// the bot invited, and the live list cannot always be read. Using
	// "live list, else roster" left everyone the bot did not invite behind
	// after a claim.
	const [liveMemberIds, trackedMemberIds, staffMemberIds] = await Promise.all([
		getThreadMemberIds(threadId),
		getTrackedThreadMemberIds(threadId),
		staffRoleId
			? getStoredStaffRoster(guildId, staffRoleId).then((members) =>
					uniqueIds(members.map((member) => member.userId)),
				)
			: Promise.resolve<string[]>([]),
	]);

	if (!liveMemberIds) {
		console.warn(
			`[Kaeru] Could not read the live member list of ticket ${threadId}; cleaning up from the tracked members and the staff roster instead. Check that the GUILD_MEMBERS server members intent is enabled.`,
		);
	}

	const removableIds = uniqueIds([
		...(liveMemberIds ?? []),
		...trackedMemberIds,
		...staffMemberIds,
	]).filter((userId) => !keep.has(userId));

	const removedMemberIds: string[] = [];
	const failedMemberIds: string[] = [];

	await Promise.all(
		removableIds.map(async (userId) => {
			try {
				await removeThreadMember(threadId, userId);
				removedMemberIds.push(userId);
			} catch (error) {
				// 404 only means the user was not in the thread, which is the
				// result we wanted. Anything else is a real failure and used to be
				// swallowed here, which is why a broken cleanup looked identical
				// to a working one.
				if (error instanceof DiscordApiError && error.status === 404) {
					return;
				}

				failedMemberIds.push(userId);
				console.warn(
					`[Kaeru] Could not remove member ${userId} from claimed ticket:`,
					error,
				);
			}
		}),
	);

	await writeTrackedThreadMembers(
		threadId,
		(await getTrackedThreadMemberIds(threadId)).filter(
			(userId) => !removedMemberIds.includes(userId),
		),
	);

	return { removedMemberIds, failedMemberIds };
}

export async function sendTicketLogMessage({
	threadId,
	emojiPath,
	content,
	comment,
}: {
	threadId: string;
	emojiPath: Parameters<typeof getEmoji>[0];
	content: string;
	comment?: string;
}) {
	const messageContent = [
		`# ${getEmoji(emojiPath)}`,
		content,
		comment?.trim() ? ["", "**Comment**", `>>> ${comment.trim()}`].join("\n") : "",
	]
		.filter(Boolean)
		.join("\n");

	await fetchDiscord(
		`/channels/${threadId}/messages`,
		process.env.DISCORD_BOT_TOKEN!,
		true,
		"POST",
		{
			content: messageContent,
			allowed_mentions: { parse: [] },
		},
	);
}

export async function notifyTicketUser(
	ticketData: TicketData,
	message: string,
) {
	try {
		const dmChannel = await fetchDiscord(
			"/users/@me/channels",
			process.env.DISCORD_BOT_TOKEN!,
			true,
			"POST",
			{ recipient_id: ticketData.userId },
		);

		if (!dmChannel?.id) {
			return;
		}

		await fetchDiscord(
			`/channels/${dmChannel.id}/messages`,
			process.env.DISCORD_BOT_TOKEN!,
			true,
			"POST",
			{
				components: [
					new ContainerBuilder()
						.addComponent(new TextDisplayBuilder().setContent(message))
						.toJSON(),
				],
				flags: 32768,
				allowed_mentions: { parse: [] },
			},
		);
	} catch (error) {
		console.warn("[Kaeru] Could not notify ticket user:", error);
	}
}

export function formatRelativeTimestamp(date = Date.now()) {
	return `<t:${Math.floor(date / 1000)}:R>`;
}

export async function closeTicketWithStatus({
	ticketData,
	threadId,
	userId,
	status,
	logEmoji,
	logText,
	lockThread,
	userMessage,
	comment,
}: {
	ticketData: TicketData;
	threadId: string;
	userId: string;
	status: string;
	logEmoji: "ticket.bubble.done" | "ticket.bubble.stale" | "ticket.bubble.close";
	logText: string;
	lockThread?: boolean;
	userMessage?: string;
	comment?: string;
}) {
	await patchThread(threadId, { locked: lockThread ?? true, archived: true });

	await updateTicket(ticketData, {
		status,
		locked: lockThread ?? true,
		closedAt: Date.now(),
		closedBy: userId,
		closeReason: comment?.trim() || null,
	});

	await clearActiveTicket(ticketData);

	await sendTicketLogMessage({
		threadId,
		emojiPath: logEmoji,
		content: `-# **<@!${userId}>** ${logText} ${formatRelativeTimestamp()}`,
		comment,
	});

	if (userMessage) {
		await notifyTicketUser(ticketData, userMessage);
	}
}
