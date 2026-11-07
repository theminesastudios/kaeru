import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	CheckboxBuilder,
	CheckboxGroupBuilder,
	ContainerBuilder,
	FileUploadBuilder,
	ModalStringSelectMenuBuilder,
	LabelBuilder,
	MessageFlags,
	ModalBuilder,
	RadioBuilder,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
	TextInputBuilder,
	TextInputStyle,
	ThumbnailBuilder,
} from "@minesa-org/mini-interaction";
import type { MessageActionRowComponent } from "@minesa-org/mini-interaction";
import type { APIContainerComponent } from "discord-api-types/v10";
import { db } from "./database.ts";
import { fetchDiscord } from "./discord.ts";
import { getEmoji, getEmojiData } from "./emojis.ts";

// Discord caps a panel action row at five buttons, a modal at five fields and
// the review tabs at one row of five, so every level tops out at five.
export const APPLICATION_MAX_BUTTONS = 5;
export const APPLICATION_MAX_PAGES = 5;
export const APPLICATION_MAX_QUESTIONS = 5;

// The router only matches exact custom ids, so every slot gets its own fixed
// id instead of encoding the slot in a dynamic suffix. Form buttons do not
// carry the position at all: it is read back from the applicant's draft.
export const APPLICATION_SETUP_MODAL_ID = "application:setup_modal";
export const APPLICATION_APPROVE_BUTTON_ID = "application:approve";
export const APPLICATION_DECLINE_BUTTON_ID = "application:decline";
export const APPLICATION_APPROVE_MODAL_ID = "application:approve_modal";
export const APPLICATION_DECLINE_MODAL_ID = "application:decline_modal";
export const APPLICATION_HISTORY_BUTTON_ID = "application:history";
export const APPLICATION_FORM_SUBMIT_BUTTON_ID = "application:form:submit";
export const APPLICATION_FORM_CANCEL_BUTTON_ID = "application:form:cancel";
export const APPLICATION_DECISION_NOTE_FIELD_ID = "note";
export const APPLICATION_DECISION_NOTIFY_FIELD_ID = "notify";

export function applicationApplyButtonId(slot: number) {
	return `application:apply:${slot}`;
}

export function applicationPageButtonId(page: number) {
	return `application:form:page:${page}`;
}

export function applicationPageModalId(page: number) {
	return `application:form:page_modal:${page}`;
}

export function applicationReviewTabId(page: number) {
	return `application:review:tab:${page}`;
}

export function applicationQuestionFieldId(index: number) {
	return `q${index}`;
}

function oneToN(count: number) {
	return Array.from({ length: count }, (_, index) => index + 1);
}

export const APPLICATION_SLOTS = oneToN(APPLICATION_MAX_BUTTONS);
export const APPLICATION_PAGES = oneToN(APPLICATION_MAX_PAGES);

export type ApplicationQuestionType = "short" | "paragraph" | "checkbox" | "radio" | "select" | "attachment";

export type ApplicationQuestion = {
	type: ApplicationQuestionType;
	label: string;
	description?: string;
	options: string[];
	optionDescriptions?: string[];
	required: boolean;
	minLength?: number;
};

export type ApplicationPage = {
	title: string;
	questions: (ApplicationQuestion | null)[];
};

export type ApplicationButtonEmoji = { id?: string; name: string; animated?: boolean };

export type ApplicationButton = {
	label: string;
	description: string;
	emoji?: ApplicationButtonEmoji | null;
	pages: (ApplicationPage | null)[];
};

export type ApplicationConfig = {
	guildId: string;
	title: string;
	description: string;
	panelChannelId: string | null;
	reviewChannelId: string | null;
	reviewerRoleId: string | null;
	panelMessageId: string | null;
	panelMessageChannelId: string | null;
	buttons: (ApplicationButton | null)[];
};

export type ApplicationAnswer = {
	label: string;
	answer: string;
	/** A file copied into the review message. */
	attachment?: {
		filename: string;
		contentType: string | null;
	};
	/** A modal upload still waiting to be copied when the form is submitted. */
	upload?: {
		url: string;
		filename: string;
		size: number;
		contentType: string | null;
	};
};

export type ApplicationRecordPage = {
	title: string;
	answers: ApplicationAnswer[];
};

export type ApplicationStatus = "pending" | "approved" | "declined";

export type ApplicationRecord = {
	ref: string;
	guildId: string;
	guildName: string | null;
	userId: string;
	username: string | null;
	avatarUrl: string | null;
	slot: number;
	buttonLabel: string;
	pages: ApplicationRecordPage[];
	submittedAt: number;
	status: ApplicationStatus;
	/** Index into `pages` of the tab the review message currently shows. */
	viewPage?: number;
	hasTranscript?: boolean;
	reviewerId?: string;
	decidedAt?: number;
	note?: string | null;
	notified?: boolean;
	dmDelivered?: boolean;
};

/** Answers collected so far, one slot per page, while the applicant fills the form. */
export type ApplicationDraft = {
	slot: number;
	pages: (ApplicationAnswer[] | null)[];
	updatedAt: number;
};

export type ApplicationHistoryEntry = {
	messageId: string;
	channelId: string;
	ref: string;
	buttonLabel: string;
	submittedAt: number;
};

export const TEXT_MAX_LENGTH = 500;
export const MAX_CHOICE_OPTIONS = 10;
export const MAX_SELECT_OPTIONS = 25;
// Components V2 messages share one 4000 character budget across every text
// display. The review header, footer and decision take part of it, so a page's
// answers get this much and longer ones move into an attached transcript.
const REVIEW_TEXT_BUDGET = 2600;
// Drafts only need to outlive one sitting.
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const HISTORY_LIMIT = 25;

function configKey(guildId: string) {
	return `application:${guildId}`;
}

function reviewKey(messageId: string) {
	return `application-review:${messageId}`;
}

function pendingKey(guildId: string, userId: string, slot: number) {
	return `application-pending:${guildId}:${userId}:${slot}`;
}

function draftKey(guildId: string, userId: string) {
	return `application-draft:${guildId}:${userId}`;
}

function historyKey(guildId: string, userId: string) {
	return `application-history:${guildId}:${userId}`;
}

function stripStorageFields<T extends Record<string, unknown>>(value: T) {
	const copy = { ...value } as Record<string, unknown>;
	delete copy._id;
	delete copy.createdAt;
	delete copy.updatedAt;
	return copy as T;
}

function normalizeEmoji(raw: unknown): ApplicationButtonEmoji | null {
	if (!raw || typeof raw !== "object") return null;
	const { id, name, animated } = raw as Record<string, unknown>;
	if (typeof name !== "string" || name.length === 0) return null;
	return {
		name,
		...(typeof id === "string" && id.length > 0 ? { id } : {}),
		...(animated === true ? { animated: true } : {}),
	};
}

/**
 * Accepts a unicode emoji or a custom one pasted as `<:name:id>` / `<a:name:id>`.
 * Returns null when the text is neither.
 */
export function parseButtonEmoji(raw: string | null | undefined): ApplicationButtonEmoji | null {
	const value = raw?.trim();
	if (!value) return null;

	const custom = value.match(/^<(a?):(\w{2,32}):(\d{17,20})>$/);
	if (custom) {
		return { id: custom[3], name: custom[2], ...(custom[1] ? { animated: true } : {}) };
	}

	const unicode =
		/^\p{Extended_Pictographic}/u.test(value) ||
		/^\p{Regional_Indicator}{2}$/u.test(value) ||
		/^[0-9#*]️?⃣$/u.test(value);

	return unicode ? { name: value } : null;
}

export function formatEmoji(emoji: ApplicationButtonEmoji | null | undefined) {
	if (!emoji) return "";
	return emoji.id ? `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>` : emoji.name;
}

function normalizeQuestions(raw: unknown) {
	const questions = Array.isArray(raw) ? raw : [];
	return Array.from({ length: APPLICATION_MAX_QUESTIONS }, (_, index) => {
		const question = questions[index];
		return question && typeof question === "object" && typeof question.label === "string"
			? (question as ApplicationQuestion)
			: null;
	});
}

function normalizePages(button: Record<string, unknown>): (ApplicationPage | null)[] {
	// Buttons saved before pages existed kept a flat question list, which
	// becomes the first page.
	if (!Array.isArray(button.pages)) {
		const pages: (ApplicationPage | null)[] = APPLICATION_PAGES.map(() => null);
		if (Array.isArray(button.questions)) {
			pages[0] = { title: "Questions", questions: normalizeQuestions(button.questions) };
		}
		return pages;
	}

	return APPLICATION_PAGES.map((_, index) => {
		const page = (button.pages as unknown[])[index] as Record<string, unknown> | null | undefined;
		if (!page || typeof page !== "object" || typeof page.title !== "string") return null;
		return { title: page.title, questions: normalizeQuestions(page.questions) };
	});
}

function normalizeButtons(raw: unknown): (ApplicationButton | null)[] {
	const source = Array.isArray(raw) ? raw : [];
	return APPLICATION_SLOTS.map((_, index) => {
		const button = source[index];
		if (!button || typeof button !== "object" || typeof button.label !== "string") {
			return null;
		}

		return {
			label: button.label,
			description: typeof button.description === "string" ? button.description : "",
			emoji: normalizeEmoji(button.emoji),
			pages: normalizePages(button),
		};
	});
}

function asId(value: unknown) {
	return typeof value === "string" && value.length > 0 ? value : null;
}

export async function getApplicationConfig(guildId: string): Promise<ApplicationConfig | null> {
	const raw = await db.get(configKey(guildId)).catch(() => null);
	if (!raw || typeof raw !== "object") return null;

	return {
		guildId,
		title: typeof raw.title === "string" ? raw.title : "Applications",
		description: typeof raw.description === "string" ? raw.description : "",
		panelChannelId: asId(raw.panelChannelId),
		reviewChannelId: asId(raw.reviewChannelId),
		reviewerRoleId: asId(raw.reviewerRoleId),
		panelMessageId: asId(raw.panelMessageId),
		panelMessageChannelId: asId(raw.panelMessageChannelId),
		buttons: normalizeButtons(raw.buttons),
	};
}

export function createEmptyApplicationConfig(guildId: string): ApplicationConfig {
	return {
		guildId,
		title: "Applications",
		description: "",
		panelChannelId: null,
		reviewChannelId: null,
		reviewerRoleId: null,
		panelMessageId: null,
		panelMessageChannelId: null,
		buttons: APPLICATION_SLOTS.map(() => null),
	};
}

export function createEmptyPage(title: string): ApplicationPage {
	return { title, questions: Array.from({ length: APPLICATION_MAX_QUESTIONS }, () => null) };
}

export async function saveApplicationConfig(config: ApplicationConfig) {
	await db.set(configKey(config.guildId), config);
}

export async function deleteApplicationConfig(guildId: string) {
	await db.delete(configKey(guildId));
}

export async function getApplicationRecord(messageId: string): Promise<ApplicationRecord | null> {
	const raw = await db.get(reviewKey(messageId)).catch(() => null);
	if (!raw || typeof raw !== "object") return null;

	const record = stripStorageFields(raw) as ApplicationRecord & { answers?: ApplicationAnswer[] };

	// Records from before pages existed stored one flat answer list.
	if (!Array.isArray(record.pages)) {
		record.pages = [{ title: "Answers", answers: Array.isArray(record.answers) ? record.answers : [] }];
	}
	delete record.answers;

	record.ref ||= messageId.slice(-8);
	record.avatarUrl ??= null;

	return record;
}

export async function saveApplicationRecord(messageId: string, record: ApplicationRecord) {
	await db.set(reviewKey(messageId), record);
}

export async function hasPendingApplication(guildId: string, userId: string, slot: number) {
	const raw = await db.get(pendingKey(guildId, userId, slot)).catch(() => null);
	return Boolean(raw && typeof raw === "object" && raw.messageId);
}

export async function markPendingApplication(
	guildId: string,
	userId: string,
	slot: number,
	messageId: string,
) {
	await db.set(pendingKey(guildId, userId, slot), { messageId, createdAt: Date.now() });
}

export async function clearPendingApplication(guildId: string, userId: string, slot: number) {
	await db.delete(pendingKey(guildId, userId, slot)).catch(() => null);
}

export async function getApplicationDraft(guildId: string, userId: string): Promise<ApplicationDraft | null> {
	const raw = await db.get(draftKey(guildId, userId)).catch(() => null);
	if (!raw || typeof raw !== "object" || typeof raw.slot !== "number") return null;
	if (typeof raw.savedAt === "number" && Date.now() - raw.savedAt > DRAFT_TTL_MS) return null;

	const pages = Array.isArray(raw.pages) ? raw.pages : [];
	return {
		slot: raw.slot,
		pages: APPLICATION_PAGES.map((_, index) => (Array.isArray(pages[index]) ? pages[index] : null)),
		updatedAt: typeof raw.savedAt === "number" ? raw.savedAt : Date.now(),
	};
}

export function createApplicationDraft(slot: number): ApplicationDraft {
	return { slot, pages: APPLICATION_PAGES.map(() => null), updatedAt: Date.now() };
}

export async function saveApplicationDraft(guildId: string, userId: string, draft: ApplicationDraft) {
	draft.updatedAt = Date.now();
	// Stored as `savedAt` because the database layer manages its own
	// `updatedAt` field.
	await db.set(draftKey(guildId, userId), { slot: draft.slot, pages: draft.pages, savedAt: draft.updatedAt });
}

export async function deleteApplicationDraft(guildId: string, userId: string) {
	await db.delete(draftKey(guildId, userId)).catch(() => null);
}

export async function getApplicationHistory(guildId: string, userId: string): Promise<ApplicationHistoryEntry[]> {
	const raw = await db.get(historyKey(guildId, userId)).catch(() => null);
	return raw && typeof raw === "object" && Array.isArray(raw.entries) ? raw.entries : [];
}

export async function addApplicationHistory(guildId: string, userId: string, entry: ApplicationHistoryEntry) {
	const entries = await getApplicationHistory(guildId, userId);
	entries.unshift(entry);
	await db.set(historyKey(guildId, userId), { entries: entries.slice(0, HISTORY_LIMIT) });
}

/**
 * Applying requires the member to have authorized Kaeru as a user app. That
 * install is what lets the bot DM them the decision even when they have
 * server DMs turned off.
 */
export async function isUserAuthorized(userId: string) {
	const userData = await db.get(userId).catch(() => null);
	return Boolean(userData?.accessToken);
}

export function getActiveQuestions(page: ApplicationPage) {
	return page.questions.filter((question): question is ApplicationQuestion => question !== null);
}

/** Pages the applicant has to fill in, with their 1-based page slot. */
export function getActivePages(button: ApplicationButton) {
	return button.pages
		.map((page, index) => ({ page, pageSlot: index + 1 }))
		.filter(
			(entry): entry is { page: ApplicationPage; pageSlot: number } =>
				entry.page !== null && getActiveQuestions(entry.page).length > 0,
		);
}

export function getPublishableButtons(config: ApplicationConfig) {
	return config.buttons
		.map((button, index) => ({ button, slot: index + 1 }))
		.filter(
			(entry): entry is { button: ApplicationButton; slot: number } =>
				entry.button !== null && getActivePages(entry.button).length > 0,
		);
}

/**
 * Reads the admin's option list. A JSON object maps each title to its
 * description, e.g. {"Yes": "I agree", "No": "Not yet"}. Plain `A, B` / `A | B`
 * lists (with an optional `A > description`) are still understood.
 */
export function parseQuestionOptions(raw: string | null | undefined) {
	const options: string[] = [];
	const descriptions: string[] = [];
	if (!raw) return { options, descriptions };

	const add = (title: unknown, description: unknown) => {
		const option = String(title ?? "").trim().slice(0, 100);
		if (!option) return;
		options.push(option);
		descriptions.push(typeof description === "string" ? description.trim().slice(0, 100) : "");
	};

	if (raw.trim().startsWith("{")) {
		try {
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				for (const [title, description] of Object.entries(parsed)) add(title, description);
				return { options, descriptions };
			}
		} catch {
			// Fall through to the plain list.
		}
	}

	const separator = raw.includes("|") ? "|" : ",";
	for (const part of raw.split(separator)) {
		const [label = "", ...rest] = part.split(">");
		add(label, rest.join(">"));
	}
	return { options, descriptions };
}

function optionDescription(question: ApplicationQuestion, index: number) {
	const description = question.optionDescriptions?.[index];
	return description ? { description } : {};
}

export function describeQuestionType(type: ApplicationQuestionType) {
	switch (type) {
		case "short":
			return "Short";
		case "paragraph":
			return "Paragraph";
		case "checkbox":
			return "Checkbox";
		case "radio":
			return "Radio";
		case "select":
			return "Select";
		case "attachment":
			return "Attachment";
	}
}

/**
 * Autocomplete for the slot options of `/application`: every slot is listed with
 * what is saved in it, so admins can tell filled slots from empty ones.
 */
export async function getApplicationAutocompleteChoices({
	guildId,
	optionName,
	query,
	selected,
}: {
	guildId: string | null;
	optionName: "button" | "page" | "slot" | "question";
	query: string;
	selected: { button?: string; page?: string };
}) {
	const config = guildId ? await getApplicationConfig(guildId) : null;
	const buttonSlot = Number(selected.button);
	const pageSlot = Number(selected.page);
	const button = Number.isInteger(buttonSlot) ? config?.buttons[buttonSlot - 1] : null;
	const page = Number.isInteger(pageSlot) ? button?.pages[pageSlot - 1] : null;

	const entries: string[] = [];
	if (optionName === "button") {
		for (let index = 0; index < APPLICATION_MAX_BUTTONS; index++) {
			const entry = config?.buttons[index];
			entries.push(entry ? `${formatEmoji(entry.emoji)} ${entry.label}`.trim() : "");
		}
	} else if (optionName === "page") {
		for (let index = 0; index < APPLICATION_MAX_PAGES; index++) {
			const entry = button?.pages[index];
			entries.push(entry ? `${entry.title} (${getActiveQuestions(entry).length}/${APPLICATION_MAX_QUESTIONS} questions)` : "");
		}
	} else {
		for (let index = 0; index < APPLICATION_MAX_QUESTIONS; index++) {
			const entry = page?.questions[index];
			entries.push(entry ? `${describeQuestionType(entry.type)}: ${entry.label}` : "");
		}
	}

	const needle = query.trim().toLowerCase();
	return entries
		.map((text, index) => ({
			name: truncate(`${index + 1} — ${text || "Empty"}`, 100),
			value: String(index + 1),
		}))
		.filter((choice) => !needle || choice.name.toLowerCase().includes(needle));
}

const MANAGE_GUILD = 1n << 5n;

/**
 * Reviewers are members with Manage Server (Discord folds Administrator into
 * the computed permissions) or the optional reviewer role from setup.
 */
export function canReviewApplications(
	member: { roles?: string[]; permissions?: string } | undefined,
	config: ApplicationConfig | null,
) {
	if (member?.permissions) {
		try {
			if ((BigInt(member.permissions) & MANAGE_GUILD) === MANAGE_GUILD) return true;
		} catch {
			// Fall through to the role check.
		}
	}

	return Boolean(config?.reviewerRoleId && member?.roles?.includes(config.reviewerRoleId));
}

function truncate(value: string, max: number) {
	return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

function quote(value: string) {
	return value
		.split("\n")
		.map((line) => `> ${line}`)
		.join("\n");
}

function separator() {
	return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export function buildApplicationPanel(config: ApplicationConfig) {
	const buttons = getPublishableButtons(config);

	const container = new ContainerBuilder().addComponent(
		new TextDisplayBuilder().setContent(
			`## ${config.title}` + (config.description ? `\n${config.description}` : ""),
		),
	);

	const row = new ActionRowBuilder<MessageActionRowComponent>().addComponents(
		...buttons.map(({ button, slot }) => {
			const builder = new ButtonBuilder()
				.setCustomId(applicationApplyButtonId(slot))
				.setLabel(button.label.slice(0, 80))
				.setStyle(ButtonStyle.Secondary);
			return button.emoji ? builder.setEmoji(button.emoji) : builder;
		}),
	);

	const containerJson = container.toJSON() as { components: unknown[] };
	containerJson.components.push(row.toJSON());

	return {
		components: [containerJson],
		flags: MessageFlags.IsComponentsV2,
	};
}

/* ------------------------------------------------------------------ */
/* Applicant form                                                      */
/* ------------------------------------------------------------------ */

export function isDraftComplete(button: ApplicationButton, draft: ApplicationDraft) {
	return getActivePages(button).every(({ pageSlot }) => draft.pages[pageSlot - 1] !== null);
}

/**
 * The ephemeral message an applicant works through: one row per page with a
 * pencil that opens that page's questions, then Submit / Cancel.
 */
export function buildApplicationForm(
	button: ApplicationButton,
	draft: ApplicationDraft,
	options: { notice?: string } = {},
) {
	const emoji = formatEmoji(button.emoji);
	const container = new ContainerBuilder().addComponent(
		new TextDisplayBuilder().setContent(
			`## ${emoji ? `${emoji} ` : ""}${button.label}` + (button.description ? `\n${button.description}` : ""),
		),
	);

	if (options.notice) {
		container.addComponent(new TextDisplayBuilder().setContent(options.notice));
	}

	container.addComponent(separator());

	for (const { page, pageSlot } of getActivePages(button)) {
		const answered = draft.pages[pageSlot - 1] !== null;

		container
			.addComponent(
				new SectionBuilder()
					.addComponent(
						new TextDisplayBuilder().setContent(
							`**${page.title}**\n-# ` +
								(answered
									? `${getEmoji("seal")} Answered. Use the pencil to change your answers.`
									: "Use the pencil to answer the questions."),
						),
					)
					.setAccessory(
						new ButtonBuilder()
							.setCustomId(applicationPageButtonId(pageSlot))
							.setEmoji(getEmojiData("pencil"))
							.setStyle(ButtonStyle.Secondary),
					),
			)
			.addComponent(separator());
	}

	const containerJson = container.toJSON() as { components: unknown[] };
	containerJson.components.push(
		new ActionRowBuilder<MessageActionRowComponent>()
			.addComponents(
				new ButtonBuilder()
					.setCustomId(APPLICATION_FORM_SUBMIT_BUTTON_ID)
					.setLabel("Submit Application")
					.setStyle(ButtonStyle.Primary)
					.setDisabled(!isDraftComplete(button, draft)),
				new ButtonBuilder()
					.setCustomId(APPLICATION_FORM_CANCEL_BUTTON_ID)
					.setLabel("Cancel")
					.setStyle(ButtonStyle.Danger),
			)
			.toJSON(),
	);

	// Raw component JSON is appended above where the builders have no helper.
	return [containerJson as unknown as APIContainerComponent];
}

/** A one-off notice that replaces the form, e.g. after submitting or cancelling. */
export function buildFormNotice(content: string) {
	return [new ContainerBuilder().addComponent(new TextDisplayBuilder().setContent(content)).toJSON()];
}

export function buildPageModal(pageSlot: number, page: ApplicationPage, previous: ApplicationAnswer[] | null) {
	const modal = new ModalBuilder()
		.setCustomId(applicationPageModalId(pageSlot))
		.setTitle(page.title.slice(0, 45));

	page.questions.forEach((question, index) => {
		if (!question) return;

		const label = new LabelBuilder().setLabel(question.label.slice(0, 45));
		const isText = question.type === "short" || question.type === "paragraph";
		const limit = isText ? TEXT_MAX_LENGTH : 0;
		// Only the question's own hint is shown; min/max length are enforced by the input itself.
		const hint = question.description ?? (question.options.length === 1 ? question.optionDescriptions?.[0] : undefined);
		if (hint) label.setDescription(hint.slice(0, 100));

		const customId = applicationQuestionFieldId(index);
		const before = previous?.find((answer) => answer.label === question.label)?.answer;

		switch (question.type) {
			case "short":
			case "paragraph": {
				const input = new TextInputBuilder()
					.setCustomId(customId)
					.setStyle(question.type === "short" ? TextInputStyle.Short : TextInputStyle.Paragraph)
					.setMaxLength(limit)
					.setRequired(question.required);
				if (question.minLength) input.setMinLength(question.minLength);
				if (before) input.setValue(before.slice(0, limit));
				label.setComponent(input);
				break;
			}
			case "select":
				label.setComponent(
					new ModalStringSelectMenuBuilder()
						.setCustomId(customId)
						.setMinValues(question.required ? 1 : 0)
						.setMaxValues(1)
						.setRequired(question.required)
						.addOptions(
							...question.options.map((option, optionIndex) => ({
								label: option,
								value: String(optionIndex),
								...optionDescription(question, optionIndex),
								...(before === option ? { default: true } : {}),
							})),
						),
				);
				break;
			case "radio":
				label.setComponent(
					new RadioBuilder()
						.setCustomId(customId)
						.setRequired(question.required)
						.addOptions(
							...question.options.map((option, optionIndex) => ({
								label: option,
								value: String(optionIndex),
								...optionDescription(question, optionIndex),
								...(before === option ? { default: true } : {}),
							})),
						),
				);
				break;
			case "checkbox": {
				// Without options the question is a single confirmation box
				// ("I have read the rules"). Discord has no `required` flag on a
				// lone checkbox, so the page handler enforces it instead.
				if (question.options.length <= 1) {
					label.setComponent(
						new CheckboxBuilder().setCustomId(customId).setDefault(before === (question.options[0] ?? "Yes")),
					);
					break;
				}

				const picked = new Set((before ?? "").split("\n").map((line) => line.replace(/^• /, "")));
				label.setComponent(
					new CheckboxGroupBuilder()
						.setCustomId(customId)
						.setRequired(question.required)
						.setMinValues(question.required ? 1 : 0)
						.setMaxValues(question.options.length)
						.addOptions(
							...question.options.map((option, optionIndex) => ({
								label: option,
								value: String(optionIndex),
								...optionDescription(question, optionIndex),
								...(picked.has(option) ? { default: true } : {}),
							})),
						),
				);
				break;
			}
			case "attachment":
				label.setComponent(
					new FileUploadBuilder()
						.setCustomId(customId)
						.setMinValues(question.required ? 1 : 0)
						.setMaxValues(1)
						.setRequired(question.required),
				);
				break;
		}

		modal.addComponents(label);
	});

	return modal;
}

/* ------------------------------------------------------------------ */
/* Review message                                                      */
/* ------------------------------------------------------------------ */

export function userAvatarUrl(user: { id: string; avatar?: string | null }) {
	if (user.avatar) {
		const ext = user.avatar.startsWith("a_") ? "gif" : "png";
		return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=256`;
	}

	try {
		return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`;
	} catch {
		return null;
	}
}

export function createApplicationRef() {
	return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

function pageNeedsTranscript(page: ApplicationRecordPage) {
	const total = page.answers.reduce((sum, answer) => sum + answer.label.length + answer.answer.length + 16, 0);
	return total > REVIEW_TEXT_BUDGET;
}

export function reviewAnswersNeedTranscript(pages: ApplicationRecordPage[]) {
	return pages.some(pageNeedsTranscript);
}

export function buildAnswersTranscript(record: ApplicationRecord) {
	const lines = [
		`Application: ${record.buttonLabel} (#${record.ref})`,
		`Applicant: ${record.username ?? "unknown"} (${record.userId})`,
		`Submitted: ${new Date(record.submittedAt).toISOString()}`,
		"",
	];

	for (const page of record.pages) {
		lines.push(`# ${page.title}`, "");
		for (const answer of page.answers) {
			lines.push(`## ${answer.label}`, answer.answer || "(no answer)", "");
		}
	}

	return lines.join("\n");
}

export const TRANSCRIPT_FILENAME = "application.txt";

/** Maps the review message's uploaded files by name, for the link-only fallback. */
export function reviewAttachmentLinks(attachments: { filename: string; url: string }[] | undefined) {
	return new Map((attachments ?? []).map((attachment) => [attachment.filename, attachment.url] as const));
}

function describeStatus(record: ApplicationRecord) {
	switch (record.status) {
		case "pending":
			return `${getEmoji("timer")} Pending`;
		case "approved":
			return `${getEmoji("seal")} Approved by <@${record.reviewerId}>`;
		case "declined":
			return `${getEmoji("error")} Rejected by <@${record.reviewerId}>`;
	}
}

/**
 * Builds the review message from the stored record so a tab switch or a
 * decision can redraw it without echoing Discord's resolved component payload
 * (whose file URLs cannot be sent back as-is). Only the selected page's
 * answers are shown; the uploaded files stay on the message either way.
 */
export function buildReviewComponents(
	record: ApplicationRecord,
	options: {
		/** filename -> URL. When set, files are listed as links instead of inline previews. */
		attachmentLinks?: Map<string, string>;
	} = {},
) {
	const viewPage = Math.min(Math.max(record.viewPage ?? 0, 0), Math.max(record.pages.length - 1, 0));
	const page = record.pages[viewPage] ?? { title: "Answers", answers: [] };

	const container = new ContainerBuilder()
		.addComponent(
			new TextDisplayBuilder().setContent(`## ${getEmoji("document")} New Application • #${record.ref}`),
		)
		.addComponent(separator());

	const details = new TextDisplayBuilder().setContent(
		quote(
			`**User:** <@${record.userId}> (${record.userId})\n` +
				`**Form:** ${record.buttonLabel}\n` +
				`**Status:** ${describeStatus(record)}` +
				(record.status !== "pending" && record.note ? `\n**Reason:** ${truncate(record.note, 500)}` : ""),
		),
	);

	if (record.avatarUrl) {
		container.addComponent(
			new SectionBuilder()
				.addComponent(details)
				.setAccessory(new ThumbnailBuilder().setMedia({ url: record.avatarUrl })),
		);
	} else {
		container.addComponent(details);
	}

	container.addComponent(separator());

	const containerJson = container.toJSON() as { components: unknown[] };
	const components = containerJson.components;
	const push = (component: unknown) => {
		const value = component as { toJSON?: () => unknown };
		components.push(typeof value.toJSON === "function" ? value.toJSON() : component);
	};

	if (record.pages.length > 1) {
		push(
			new ActionRowBuilder<MessageActionRowComponent>().addComponents(
				...record.pages.map((tab, index) =>
					new ButtonBuilder()
						.setCustomId(applicationReviewTabId(index + 1))
						.setLabel(tab.title.slice(0, 80))
						.setStyle(index === viewPage ? ButtonStyle.Primary : ButtonStyle.Secondary),
				),
			),
		);
		push(separator());
	}

	const perAnswerBudget = Math.max(
		120,
		Math.floor(REVIEW_TEXT_BUDGET / Math.max(1, page.answers.length)) - 60,
	);

	for (const answer of page.answers) {
		const body = answer.answer.trim().length > 0 ? answer.answer : "*No answer*";
		push(new TextDisplayBuilder().setContent(`**${answer.label}**\n${quote(truncate(body, perAnswerBudget))}`));
	}

	const links = options.attachmentLinks;
	const showTranscript = record.hasTranscript && pageNeedsTranscript(page);

	if (links) {
		// Fallback: Discord refused the inline previews, so list plain links.
		const lines = page.answers.flatMap((answer) => {
			if (!answer.attachment) return [];
			const { filename } = answer.attachment;
			const url = links.get(filename);
			return [`${answer.label}: ${url ? `[${filename}](${url})` : `\`${filename}\``}`];
		});

		if (showTranscript) {
			const url = links.get(TRANSCRIPT_FILENAME);
			lines.push(`Transcript: ${url ? `[${TRANSCRIPT_FILENAME}](${url})` : TRANSCRIPT_FILENAME}`);
		}

		if (lines.length > 0) {
			push(new TextDisplayBuilder().setContent(`-# ${lines.join("\n-# ")}`.slice(0, 1500)));
		}
	} else {
		const images = page.answers.filter((answer) => answer.attachment?.contentType?.startsWith("image/"));
		const files = page.answers.filter(
			(answer) => answer.attachment && !answer.attachment.contentType?.startsWith("image/"),
		);

		if (images.length > 0) {
			push({
				type: 12,
				items: images.map((answer) => ({
					media: { url: `attachment://${answer.attachment!.filename}` },
					description: answer.label.slice(0, 1024),
				})),
			});
		}

		for (const answer of files) {
			push({ type: 13, file: { url: `attachment://${answer.attachment!.filename}` } });
		}

		if (showTranscript) {
			push(
				new TextDisplayBuilder().setContent(
					"-# Some answers were shortened. The full text is in the attached transcript.",
				),
			);
			push({ type: 13, file: { url: `attachment://${TRANSCRIPT_FILENAME}` } });
		}
	}

	push(separator());

	let footer = `-# Submitted by <@${record.userId}> • <t:${Math.floor(record.submittedAt / 1000)}:F>`;
	if (record.status !== "pending") {
		const decidedAt = Math.floor((record.decidedAt ?? Date.now()) / 1000);
		const delivery = !record.notified
			? "applicant not notified"
			: record.dmDelivered
				? "DM delivered"
				: "could not DM the applicant";
		footer += `\n-# Decided <t:${decidedAt}:R> • ${delivery}`;
	}
	push(new TextDisplayBuilder().setContent(footer));

	const actions = new ActionRowBuilder<MessageActionRowComponent>();
	if (record.status === "pending") {
		actions.addComponents(
			new ButtonBuilder()
				.setCustomId(APPLICATION_APPROVE_BUTTON_ID)
				.setLabel("Accept")
				.setStyle(ButtonStyle.Success),
			new ButtonBuilder()
				.setCustomId(APPLICATION_DECLINE_BUTTON_ID)
				.setLabel("Reject")
				.setStyle(ButtonStyle.Danger),
		);
	}
	actions.addComponents(
		new ButtonBuilder()
			.setCustomId(APPLICATION_HISTORY_BUTTON_ID)
			.setLabel("User History")
			.setStyle(ButtonStyle.Secondary),
	);
	push(actions);

	// Raw component JSON is appended above where the builders have no helper.
	return [containerJson as unknown as APIContainerComponent];
}

/* ------------------------------------------------------------------ */
/* Decision DM                                                         */
/* ------------------------------------------------------------------ */

const APPROVED_ACCENT = 0x23a55a;
const DECLINED_ACCENT = 0xda373c;

export async function sendApplicationDecisionDm(record: ApplicationRecord) {
	const token = process.env.DISCORD_BOT_TOKEN!;
	const approved = record.status === "approved";
	const guildLabel = record.guildName
		? `[${record.guildName.replace(/[[\]]/g, "")}](https://discord.com/channels/${record.guildId})`
		: "the server";

	const dmChannel = await fetchDiscord("/users/@me/channels", token, true, "POST", {
		recipient_id: record.userId,
	});

	if (!dmChannel?.id) {
		throw new Error("Discord did not return a DM channel.");
	}

	const container = new ContainerBuilder()
		.setAccentColor(approved ? APPROVED_ACCENT : DECLINED_ACCENT)
		.addComponent(
			new TextDisplayBuilder().setContent(`## ${approved ? "✅ Application Approved" : "❌ Application Rejected"}`),
		)
		.addComponent(separator())
		.addComponent(
			new TextDisplayBuilder().setContent(
				`Your application for **${guildLabel}** has been ${approved ? "approved" : "rejected"}.\n` +
					quote(
						`**Application:** ${record.buttonLabel}\n` +
							`**Moderator:** <@${record.reviewerId}>` +
							(record.note ? `\n**Reason:** ${truncate(record.note, 1500)}` : ""),
					),
			),
		)
		.addComponent(separator())
		.addComponent(
			new TextDisplayBuilder().setContent(
				`-# Application ID: #${record.ref} · <t:${Math.floor(record.submittedAt / 1000)}:F>`,
			),
		);

	await fetchDiscord(`/channels/${dmChannel.id}/messages`, token, true, "POST", {
		components: [container.toJSON()],
		flags: MessageFlags.IsComponentsV2,
		allowed_mentions: { parse: [] },
	});
}

/* ------------------------------------------------------------------ */
/* Uploads                                                             */
/* ------------------------------------------------------------------ */

type OutgoingFile = { filename: string; bytes: ArrayBuffer; contentType: string };

/**
 * Posts (or edits) a message with optional uploaded files. `fetchDiscord`
 * only speaks JSON, so multipart uploads go through fetch directly.
 */
export async function sendDiscordMessageWithFiles(
	method: "POST" | "PATCH",
	endpoint: string,
	payload: Record<string, unknown>,
	files: OutgoingFile[],
) {
	const url = `https://discord.com/api/v10${endpoint}`;
	const headers: Record<string, string> = {
		Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
	};

	let body: BodyInit;
	if (files.length > 0) {
		const formData = new FormData();
		formData.append(
			"payload_json",
			JSON.stringify({
				...payload,
				attachments: files.map((file, index) => ({ id: index, filename: file.filename })),
			}),
		);
		files.forEach((file, index) => {
			formData.append(`files[${index}]`, new Blob([file.bytes], { type: file.contentType }), file.filename);
		});
		body = formData;
	} else {
		headers["Content-Type"] = "application/json";
		body = JSON.stringify(payload);
	}

	const response = await fetch(url, { method, headers, body });
	if (!response.ok) {
		throw new Error(`Discord API error: ${response.status} ${await response.text()}`);
	}

	return (await response.json()) as { id: string; channel_id: string };
}

export function sanitizeFilename(name: string, fallback: string) {
	const cleaned = name.replace(/[^\w.\-]+/g, "_").slice(-80);
	return cleaned.length > 0 ? cleaned : fallback;
}
