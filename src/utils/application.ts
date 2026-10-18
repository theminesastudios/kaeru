import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	CheckboxBuilder,
	CheckboxGroupBuilder,
	ContainerBuilder,
	FileUploadBuilder,
	LabelBuilder,
	MessageFlags,
	ModalBuilder,
	RadioBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "@minesa-org/mini-interaction";
import type { MessageActionRowComponent } from "@minesa-org/mini-interaction";
import { db } from "./database.ts";
import { fetchDiscord } from "./discord.ts";
import { getEmoji } from "./emojis.ts";

// Discord caps a modal at five labels and a message action row at five
// buttons, which is where the 5 x 5 = 25 question ceiling comes from.
export const APPLICATION_MAX_BUTTONS = 5;
export const APPLICATION_MAX_QUESTIONS = 5;

// The router only matches exact custom ids, so every slot gets its own fixed
// id instead of encoding the slot in a dynamic suffix.
export const APPLICATION_SETUP_MODAL_ID = "application:setup_modal";
export const APPLICATION_APPROVE_BUTTON_ID = "application:approve";
export const APPLICATION_DECLINE_BUTTON_ID = "application:decline";
export const APPLICATION_APPROVE_MODAL_ID = "application:approve_modal";
export const APPLICATION_DECLINE_MODAL_ID = "application:decline_modal";

export function applicationApplyButtonId(slot: number) {
	return `application:apply:${slot}`;
}

export function applicationSubmitModalId(slot: number) {
	return `application:submit:${slot}`;
}

export function applicationQuestionFieldId(index: number) {
	return `q${index}`;
}

export const APPLICATION_SLOTS = Array.from({ length: APPLICATION_MAX_BUTTONS }, (_, index) => index + 1);

export type ApplicationQuestionType = "paragraph" | "checkbox" | "radio" | "attachment";

export type ApplicationQuestion = {
	type: ApplicationQuestionType;
	label: string;
	description?: string;
	options: string[];
	required: boolean;
};

export type ApplicationButton = {
	label: string;
	questions: (ApplicationQuestion | null)[];
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
	attachment?: {
		filename: string;
		contentType: string | null;
	};
};

export type ApplicationStatus = "pending" | "approved" | "declined";

export type ApplicationRecord = {
	guildId: string;
	guildName: string | null;
	userId: string;
	username: string | null;
	slot: number;
	buttonLabel: string;
	answers: ApplicationAnswer[];
	submittedAt: number;
	status: ApplicationStatus;
	reviewerId?: string;
	decidedAt?: number;
	note?: string | null;
	dmDelivered?: boolean;
};

export const PARAGRAPH_MAX_LENGTH = 1000;
// Components V2 messages share one 4000 character budget across every text
// display, so the answers get trimmed below that and the full text goes into
// an attached transcript instead.
const REVIEW_TEXT_BUDGET = 3400;

function configKey(guildId: string) {
	return `application:${guildId}`;
}

function reviewKey(messageId: string) {
	return `application-review:${messageId}`;
}

function pendingKey(guildId: string, userId: string, slot: number) {
	return `application-pending:${guildId}:${userId}:${slot}`;
}

function stripStorageFields<T extends Record<string, unknown>>(value: T) {
	const copy = { ...value } as Record<string, unknown>;
	delete copy._id;
	delete copy.createdAt;
	delete copy.updatedAt;
	return copy as T;
}

function normalizeButtons(raw: unknown): (ApplicationButton | null)[] {
	const source = Array.isArray(raw) ? raw : [];
	return APPLICATION_SLOTS.map((_, index) => {
		const button = source[index];
		if (!button || typeof button !== "object" || typeof button.label !== "string") {
			return null;
		}

		const questions = Array.isArray(button.questions) ? button.questions : [];
		return {
			label: button.label,
			questions: Array.from({ length: APPLICATION_MAX_QUESTIONS }, (_, questionIndex) => {
				const question = questions[questionIndex];
				return question && typeof question === "object" && typeof question.label === "string"
					? (question as ApplicationQuestion)
					: null;
			}),
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

export async function saveApplicationConfig(config: ApplicationConfig) {
	await db.set(configKey(config.guildId), config);
}

export async function deleteApplicationConfig(guildId: string) {
	await db.delete(configKey(guildId));
}

export async function getApplicationRecord(messageId: string): Promise<ApplicationRecord | null> {
	const raw = await db.get(reviewKey(messageId)).catch(() => null);
	if (!raw || typeof raw !== "object") return null;
	return stripStorageFields(raw) as ApplicationRecord;
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

/**
 * Applying requires the member to have authorized Kaeru as a user app. That
 * install is what lets the bot DM them the decision even when they have
 * server DMs turned off.
 */
export async function isUserAuthorized(userId: string) {
	const userData = await db.get(userId).catch(() => null);
	return Boolean(userData?.accessToken);
}

export function getActiveQuestions(button: ApplicationButton) {
	return button.questions.filter((question): question is ApplicationQuestion => question !== null);
}

export function getPublishableButtons(config: ApplicationConfig) {
	return config.buttons
		.map((button, index) => ({ button, slot: index + 1 }))
		.filter(
			(entry): entry is { button: ApplicationButton; slot: number } =>
				entry.button !== null && getActiveQuestions(entry.button).length > 0,
		);
}

/**
 * Splits the admin's option list. A pipe wins when present so labels can keep
 * their commas; otherwise commas separate the options.
 */
export function parseQuestionOptions(raw: string | null | undefined) {
	if (!raw) return [];
	const separator = raw.includes("|") ? "|" : ",";
	return raw
		.split(separator)
		.map((option) => option.trim().slice(0, 100))
		.filter((option) => option.length > 0);
}

export function describeQuestionType(type: ApplicationQuestionType) {
	switch (type) {
		case "paragraph":
			return "Paragraph";
		case "checkbox":
			return "Checkbox";
		case "radio":
			return "Radio";
		case "attachment":
			return "Attachment";
	}
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

export function buildApplicationModal(slot: number, button: ApplicationButton) {
	const modal = new ModalBuilder()
		.setCustomId(applicationSubmitModalId(slot))
		.setTitle(button.label.slice(0, 45));

	button.questions.forEach((question, index) => {
		if (!question) return;

		const label = new LabelBuilder().setLabel(question.label.slice(0, 45));
		if (question.description) {
			label.setDescription(question.description.slice(0, 100));
		}

		const customId = applicationQuestionFieldId(index);

		switch (question.type) {
			case "paragraph":
				label.setComponent(
					new TextInputBuilder()
						.setCustomId(customId)
						.setStyle(TextInputStyle.Paragraph)
						.setMaxLength(PARAGRAPH_MAX_LENGTH)
						.setRequired(question.required),
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
							})),
						),
				);
				break;
			case "checkbox":
				// Without options the question is a single confirmation box
				// ("I have read the rules"). Discord has no `required` flag on a
				// lone checkbox, so the submit handler enforces it instead.
				if (question.options.length === 0) {
					label.setComponent(new CheckboxBuilder().setCustomId(customId));
					break;
				}

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
							})),
						),
				);
				break;
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

export function buildApplicationPanel(config: ApplicationConfig) {
	const buttons = getPublishableButtons(config);

	const container = new ContainerBuilder().addComponent(
		new TextDisplayBuilder().setContent(
			`## ${getEmoji("document")} ${config.title}` +
				(config.description ? `\n${config.description}` : ""),
		),
	);

	container.addComponent(
		new TextDisplayBuilder().setContent(
			"-# Applying requires authorizing Kaeru so the result can reach your DMs, even if they are closed.",
		),
	);

	const row = new ActionRowBuilder<MessageActionRowComponent>().addComponents(
		...buttons.map(({ button, slot }) =>
			new ButtonBuilder()
				.setCustomId(applicationApplyButtonId(slot))
				.setLabel(button.label.slice(0, 80))
				.setStyle(ButtonStyle.Primary),
		),
	);

	return {
		components: [container.toJSON(), row.toJSON()],
		flags: MessageFlags.IsComponentsV2,
	};
}

function truncate(value: string, max: number) {
	return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

function formatAnswerBlock(answer: ApplicationAnswer, maxAnswerLength: number) {
	const body = answer.answer.trim().length > 0 ? answer.answer : "*No answer*";
	const quoted = truncate(body, maxAnswerLength)
		.split("\n")
		.map((line) => `> ${line}`)
		.join("\n");
	return `**${answer.label}**\n${quoted}`;
}

export function reviewAnswersNeedTranscript(answers: ApplicationAnswer[]) {
	const total = answers.reduce((sum, answer) => sum + answer.label.length + answer.answer.length + 16, 0);
	return total > REVIEW_TEXT_BUDGET;
}

export function buildAnswersTranscript(record: ApplicationRecord) {
	const lines = [
		`Application: ${record.buttonLabel}`,
		`Applicant: ${record.username ?? "unknown"} (${record.userId})`,
		`Submitted: ${new Date(record.submittedAt).toISOString()}`,
		"",
	];

	for (const answer of record.answers) {
		lines.push(`## ${answer.label}`, answer.answer || "(no answer)", "");
	}

	return lines.join("\n");
}

export const TRANSCRIPT_FILENAME = "application.txt";

/**
 * Builds the review message from the stored record so a decision can redraw
 * the whole message without echoing Discord's resolved component payload
 * (whose file URLs cannot be sent back as-is).
 */
export function buildReviewComponents(record: ApplicationRecord, options: { hasTranscript: boolean }) {
	const perAnswerBudget = Math.max(
		120,
		Math.floor(REVIEW_TEXT_BUDGET / Math.max(1, record.answers.length)) - 60,
	);

	const container = new ContainerBuilder()
		.addComponent(
			new TextDisplayBuilder().setContent(
				`## ${getEmoji("document")} ${record.buttonLabel}\n` +
					`${getEmoji("people")} <@${record.userId}> (\`${record.userId}\`) • submitted <t:${Math.floor(
						record.submittedAt / 1000,
					)}:R>`,
			),
		)
		.addComponent(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

	const components: unknown[] = [];

	for (const answer of record.answers) {
		container.addComponent(new TextDisplayBuilder().setContent(formatAnswerBlock(answer, perAnswerBudget)));
	}

	const containerJson = container.toJSON() as { components: unknown[] };

	const images = record.answers.filter((answer) => answer.attachment?.contentType?.startsWith("image/"));
	const files = record.answers.filter(
		(answer) => answer.attachment && !answer.attachment.contentType?.startsWith("image/"),
	);

	if (images.length > 0) {
		containerJson.components.push({
			type: 12,
			items: images.map((answer) => ({
				media: { url: `attachment://${answer.attachment!.filename}` },
				description: answer.label.slice(0, 1024),
			})),
		});
	}

	for (const answer of files) {
		containerJson.components.push({
			type: 13,
			file: { url: `attachment://${answer.attachment!.filename}` },
		});
	}

	if (options.hasTranscript) {
		containerJson.components.push({
			type: 10,
			content: "-# Some answers were shortened. The full text is in the attached transcript.",
		});
		containerJson.components.push({
			type: 13,
			file: { url: `attachment://${TRANSCRIPT_FILENAME}` },
		});
	}

	components.push(containerJson);

	if (record.status === "pending") {
		components.push(
			new ActionRowBuilder<MessageActionRowComponent>()
				.addComponents(
					new ButtonBuilder()
						.setCustomId(APPLICATION_APPROVE_BUTTON_ID)
						.setLabel("Approve")
						.setStyle(ButtonStyle.Success),
					new ButtonBuilder()
						.setCustomId(APPLICATION_DECLINE_BUTTON_ID)
						.setLabel("Decline")
						.setStyle(ButtonStyle.Danger),
				)
				.toJSON(),
		);
	} else {
		const verb = record.status === "approved" ? "Approved" : "Declined";
		const emoji = record.status === "approved" ? getEmoji("seal") : getEmoji("error");
		const decidedAt = Math.floor((record.decidedAt ?? Date.now()) / 1000);
		const delivery = record.dmDelivered
			? "DM delivered"
			: `${getEmoji("error")} could not DM the applicant`;

		components.push({
			type: 10,
			content:
				`${emoji} **${verb}** by <@${record.reviewerId}> <t:${decidedAt}:R> • ${delivery}` +
				(record.note ? `\n> ${truncate(record.note, 500).split("\n").join("\n> ")}` : ""),
		});
	}

	return components;
}

export async function sendApplicationDecisionDm(record: ApplicationRecord) {
	const token = process.env.DISCORD_BOT_TOKEN!;
	const approved = record.status === "approved";
	const guildLabel = record.guildName ? `**${record.guildName}**` : "the server";

	const dmChannel = await fetchDiscord("/users/@me/channels", token, true, "POST", {
		recipient_id: record.userId,
	});

	if (!dmChannel?.id) {
		throw new Error("Discord did not return a DM channel.");
	}

	const content =
		`## ${approved ? getEmoji("seal") : getEmoji("error")} Application ${approved ? "approved" : "declined"}\n` +
		`Your **${record.buttonLabel}** application in ${guildLabel} was ${approved ? "approved" : "declined"}.`;

	const container = new ContainerBuilder().addComponent(new TextDisplayBuilder().setContent(content));

	if (record.note) {
		container.addComponent(
			new TextDisplayBuilder().setContent(
				`**Message from the staff**\n> ${truncate(record.note, 1500).split("\n").join("\n> ")}`,
			),
		);
	}

	container.addComponent(
		new TextDisplayBuilder().setContent(`-# Submitted <t:${Math.floor(record.submittedAt / 1000)}:f>`),
	);

	await fetchDiscord(`/channels/${dmChannel.id}/messages`, token, true, "POST", {
		components: [container.toJSON()],
		flags: MessageFlags.IsComponentsV2,
	});
}

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
