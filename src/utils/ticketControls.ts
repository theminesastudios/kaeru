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
import { fetchDiscord } from "./discord.ts";
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

export async function canUseTicketStaffControls(
	interaction: {
		guild_id?: string;
		user?: { id: string; username?: string };
		member?: { user?: { id: string; username?: string }; roles?: string[] };
	},
	ticketData: TicketData,
) {
	const guildData = await db.get(`guild:${ticketData.guildId}`).catch(() => null);
	const staffRoleId =
		typeof guildData?.pingRoleId === "string" ? guildData.pingRoleId : null;

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
		message: `Only members of <@&${staffRoleId}> can manage this ticket.`,
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

export async function getRandomStaffMember(guildId: string, staffRoleId: string) {
	const candidates = await getStaffRoleMembers(guildId, staffRoleId);

	if (candidates.length === 0) {
		return null;
	}

	return candidates[Math.floor(Math.random() * candidates.length)];
}

export async function getStaffRoleMembers(guildId: string, staffRoleId: string) {
	const members = await fetchDiscord(
		`/guilds/${guildId}/members?limit=1000`,
		process.env.DISCORD_BOT_TOKEN!,
		true,
		"GET",
		null,
		8000,
	).catch((error) => {
		console.warn("[Kaeru] Could not fetch guild members for ticket assignment:", error);
		return [];
	});

	if (!Array.isArray(members)) {
		return [];
	}

	return members.filter(
		(member) =>
			Array.isArray(member?.roles) &&
			member.roles.includes(staffRoleId) &&
			typeof member.user?.id === "string" &&
			!member.user?.bot,
	);
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
	const userId = member?.user?.id;

	if (!userId) {
		return null;
	}

	await addThreadMember(threadId, userId).catch((error) => {
		console.warn("[Kaeru] Could not add randomly assigned staff member:", error);
	});

	return {
		claimedById: userId,
		claimedByUsername:
			member.user?.username ?? member.nick ?? "Assigned staff member",
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
	const previousStaffId =
		typeof ticketData.claimedById === "string" ? ticketData.claimedById : null;
	const guildData = await db.get(`guild:${ticketData.guildId}`).catch(() => null);
	const staffRoleId =
		typeof ticketData.staffRoleId === "string"
			? ticketData.staffRoleId
			: typeof guildData?.pingRoleId === "string"
				? guildData.pingRoleId
				: null;

	await addThreadMember(threadId, claimant.id);

	await removeOtherStaffRoleMembersFromThread({
		guildId: ticketData.guildId,
		threadId,
		staffRoleId,
		keepUserId: claimant.id,
	});

	if (previousStaffId && previousStaffId !== claimant.id) {
		await removeThreadMember(threadId, previousStaffId).catch((error) => {
			console.warn("[Kaeru] Could not remove previous claimed staff member:", error);
		});
	}

	return updateTicket(ticketData, {
		claimedById: claimant.id,
		claimedByUsername: claimant.username ?? null,
		claimedAt: Date.now(),
		claimMode: "manual",
	});
}

export async function removeOtherStaffRoleMembersFromThread({
	guildId,
	threadId,
	staffRoleId,
	keepUserId,
}: {
	guildId: string;
	threadId: string;
	staffRoleId?: string | null;
	keepUserId: string;
}) {
	if (!staffRoleId) {
		return;
	}

	const staffMembers = await getStaffRoleMembers(guildId, staffRoleId);
	await Promise.all(
		staffMembers
			.filter((member) => member.user?.id && member.user.id !== keepUserId)
			.map((member) =>
				removeThreadMember(threadId, member.user.id).catch((error) => {
					console.warn(
						`[Kaeru] Could not remove staff member ${member.user.id} from claimed ticket:`,
						error,
					);
				}),
			),
	);
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
	lockThread: boolean;
	userMessage: string;
	comment?: string;
}) {
	await patchThread(
		threadId,
		lockThread ? { locked: true, archived: true } : { archived: true },
	);
	await updateTicket(ticketData, {
		status,
		locked: lockThread ? true : Boolean(ticketData.locked),
		closedAt: Date.now(),
		closedBy: userId,
		closeReason: comment ?? null,
	});
	await clearActiveTicket(ticketData);
	await sendTicketLogMessage({
		threadId,
		emojiPath: logEmoji,
		content: `-# **<@!${userId}>** ${logText} ${formatRelativeTimestamp()}`,
		comment,
	});
	await notifyTicketUser(ticketData, userMessage);
}
