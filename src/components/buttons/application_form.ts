import type {
	ButtonInteraction,
	InteractionComponent,
	MessageComponentInteraction,
} from "@minesa-org/mini-interaction";
import { MessageFlags } from "@minesa-org/mini-interaction";
import { fetchDiscord } from "../../utils/discord.ts";
import { getEmoji } from "../../utils/index.ts";
import { getInteractionUser } from "../../utils/ticketControls.ts";
import {
	APPLICATION_FORM_CANCEL_BUTTON_ID,
	APPLICATION_FORM_SUBMIT_BUTTON_ID,
	APPLICATION_PAGES,
	TRANSCRIPT_FILENAME,
	addApplicationHistory,
	applicationPageButtonId,
	buildAnswersTranscript,
	buildApplicationForm,
	buildFormNotice,
	buildPageModal,
	buildReviewComponents,
	createApplicationRef,
	deleteApplicationDraft,
	getActivePages,
	getApplicationConfig,
	getApplicationDraft,
	hasPendingApplication,
	isDraftComplete,
	markPendingApplication,
	reviewAnswersNeedTranscript,
	saveApplicationRecord,
	sendDiscordMessageWithFiles,
	userAvatarUrl,
} from "../../utils/application.ts";
import type { ApplicationAnswer, ApplicationRecord, ApplicationRecordPage } from "../../utils/application.ts";

type FormInteraction = ButtonInteraction & MessageComponentInteraction;

// Bots can always upload up to 10 MiB; anything larger stays a link.
const MAX_REUPLOAD_BYTES = 10 * 1024 * 1024;

type UploadFile = { filename: string; bytes: ArrayBuffer; contentType: string };

const EXPIRED_NOTICE = `${getEmoji("error")} This form has expired. Press the application button again to start over.`;

function createPageButton(pageSlot: number): InteractionComponent {
	return {
		customId: applicationPageButtonId(pageSlot),

		handler: async (interaction) => {
			const buttonInteraction = interaction as FormInteraction;
			const guildId = buttonInteraction.guild_id;
			const user = getInteractionUser(buttonInteraction);
			if (!guildId || !user) return;

			// The modal has to be the first response, so both reads run in
			// parallel to stay inside the auto-defer window.
			const startedAt = Date.now();
			const [config, draft] = await Promise.all([
				getApplicationConfig(guildId),
				getApplicationDraft(guildId, user.id),
			]);

			// A modal must be the first response (Discord allows 3s), so slow reads
			// here are what makes the button fail. Surface them in the logs.
			const readMs = Date.now() - startedAt;
			if (readMs > 800) console.warn(`[application] Page ${pageSlot} button reads took ${readMs}ms before showModal.`);

			const button = draft ? config?.buttons[draft.slot - 1] : null;
			const page = button?.pages[pageSlot - 1];

			if (!draft || !button || !page) {
				return buttonInteraction.update({ components: buildFormNotice(EXPIRED_NOTICE) });
			}

			return buttonInteraction.showModal(buildPageModal(pageSlot, page, draft.pages[pageSlot - 1]));
		},
	};
}

/** Copies modal uploads into files for the review message while their URLs still work. */
async function collectUploads(pages: ApplicationRecordPage[]) {
	const files: UploadFile[] = [];

	for (const page of pages) {
		for (const answer of page.answers) {
			const upload = answer.upload;
			delete answer.upload;
			if (!upload) continue;

			if (upload.size <= MAX_REUPLOAD_BYTES) {
				try {
					const response = await fetch(upload.url);
					if (response.ok) {
						files.push({
							filename: upload.filename,
							bytes: await response.arrayBuffer(),
							contentType:
								upload.contentType ?? response.headers.get("content-type") ?? "application/octet-stream",
						});
						answer.attachment = { filename: upload.filename, contentType: upload.contentType };
						continue;
					}
				} catch (error) {
					console.warn("[application] Failed to copy attachment:", error);
				}
			}

			// Too large or no longer downloadable: keep a link instead.
			answer.answer = `[${answer.answer.replace(/`/g, "")}](${upload.url})`;
		}
	}

	return files;
}

const submitButton: InteractionComponent = {
	customId: APPLICATION_FORM_SUBMIT_BUTTON_ID,

	handler: async (interaction) => {
		const buttonInteraction = interaction as FormInteraction;
		const guildId = buttonInteraction.guild_id;
		const user = getInteractionUser(buttonInteraction);
		if (!guildId || !user) return;

		// Copying files and posting to the review channel can take a few
		// seconds, so the form is acknowledged first and edited afterwards.
		buttonInteraction.deferUpdate();

		const [config, draft] = await Promise.all([
			getApplicationConfig(guildId),
			getApplicationDraft(guildId, user.id),
		]);

		const button = draft ? config?.buttons[draft.slot - 1] : null;

		if (!config?.reviewChannelId || !draft || !button) {
			return buttonInteraction.editReply({ components: buildFormNotice(EXPIRED_NOTICE) });
		}

		if (!isDraftComplete(button, draft)) {
			return buttonInteraction.editReply({
				components: buildApplicationForm(button, draft, {
					notice: `${getEmoji("error")} Answer every section before submitting.`,
				}),
			});
		}

		// Covers double submits and a second form opened in another tab.
		if (await hasPendingApplication(guildId, user.id, draft.slot)) {
			await deleteApplicationDraft(guildId, user.id);
			return buttonInteraction.editReply({
				components: buildFormNotice(
					`${getEmoji("timer")} You already have a **${button.label}** application waiting for review.`,
				),
			});
		}

		const pages: ApplicationRecordPage[] = getActivePages(button).map(({ page, pageSlot }) => ({
			title: page.title,
			answers: (draft.pages[pageSlot - 1] ?? []).map((answer: ApplicationAnswer) => ({ ...answer })),
		}));

		const [files, guild] = await Promise.all([
			collectUploads(pages),
			fetchDiscord(`/guilds/${guildId}`, process.env.DISCORD_BOT_TOKEN!, true).catch(() => null),
		]);

		const record: ApplicationRecord = {
			ref: createApplicationRef(),
			guildId,
			guildName: typeof guild?.name === "string" ? guild.name : null,
			userId: user.id,
			username: user.username ?? null,
			// The interaction carries the full user object even though the
			// helper's type only names id and username.
			avatarUrl: userAvatarUrl(user as { id: string; avatar?: string | null }),
			slot: draft.slot,
			buttonLabel: button.label,
			pages,
			submittedAt: Date.now(),
			status: "pending",
			viewPage: 0,
			hasTranscript: reviewAnswersNeedTranscript(pages),
		};

		if (record.hasTranscript) {
			files.push({
				filename: TRANSCRIPT_FILENAME,
				bytes: new TextEncoder().encode(buildAnswersTranscript(record)).buffer as ArrayBuffer,
				contentType: "text/plain; charset=utf-8",
			});
		}

		let message: { id: string; channel_id: string };
		try {
			message = await sendDiscordMessageWithFiles(
				"POST",
				`/channels/${config.reviewChannelId}/messages`,
				{
					components: buildReviewComponents(record),
					flags: MessageFlags.IsComponentsV2,
					allowed_mentions: { parse: [] },
				},
				files,
			);
		} catch (error) {
			console.error(
				`[application] Failed to post to review channel ${config.reviewChannelId} in guild ${guildId}:`,
				error,
			);
			return buttonInteraction.editReply({
				components: buildApplicationForm(button, draft, {
					notice: `${getEmoji("error")} Your application could not be delivered to the staff. Please try again later or contact a moderator.`,
				}),
			});
		}

		// The message is already in the review channel, so a storage hiccup
		// must not tell the applicant it failed (they would resend it).
		try {
			await Promise.all([
				saveApplicationRecord(message.id, record),
				markPendingApplication(guildId, user.id, draft.slot, message.id),
				addApplicationHistory(guildId, user.id, {
					messageId: message.id,
					channelId: message.channel_id,
					ref: record.ref,
					buttonLabel: record.buttonLabel,
					submittedAt: record.submittedAt,
				}),
				deleteApplicationDraft(guildId, user.id),
			]);
		} catch (error) {
			console.error("[application] Posted for review but failed to save the record:", error);
		}

		return buttonInteraction.editReply({
			components: buildFormNotice(
				`## ${getEmoji("seal")} Application sent\n` +
					`Your **${button.label}** application was sent to the staff. You will get a DM from me once they review it.\n` +
					`-# Application ID: #${record.ref}`,
			),
		});
	},
};

const cancelButton: InteractionComponent = {
	customId: APPLICATION_FORM_CANCEL_BUTTON_ID,

	handler: async (interaction) => {
		const buttonInteraction = interaction as FormInteraction;
		const guildId = buttonInteraction.guild_id;
		const user = getInteractionUser(buttonInteraction);
		if (!guildId || !user) return;

		await deleteApplicationDraft(guildId, user.id);

		return buttonInteraction.update({
			components: buildFormNotice(`${getEmoji("error")} Application cancelled. Your answers were discarded.`),
		});
	},
};

export default [...APPLICATION_PAGES.map(createPageButton), submitButton, cancelButton];
