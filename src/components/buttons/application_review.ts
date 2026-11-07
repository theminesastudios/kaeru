import {
	CheckboxBuilder,
	ContainerBuilder,
	InteractionFlags,
	LabelBuilder,
	ModalBuilder,
	TextDisplayBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "@minesa-org/mini-interaction";
import type {
	ButtonInteraction,
	InteractionComponent,
	MessageComponentInteraction,
} from "@minesa-org/mini-interaction";
import { InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { getEmoji } from "../../utils/index.ts";
import {
	APPLICATION_APPROVE_BUTTON_ID,
	APPLICATION_APPROVE_MODAL_ID,
	APPLICATION_DECISION_NOTE_FIELD_ID,
	APPLICATION_DECISION_NOTIFY_FIELD_ID,
	APPLICATION_DECLINE_BUTTON_ID,
	APPLICATION_DECLINE_MODAL_ID,
	APPLICATION_HISTORY_BUTTON_ID,
	APPLICATION_PAGES,
	applicationReviewTabId,
	buildReviewComponents,
	canReviewApplications,
	getApplicationConfig,
	getApplicationHistory,
	getApplicationRecord,
	reviewAttachmentLinks,
	saveApplicationRecord,
} from "../../utils/application.ts";

type ReviewInteraction = ButtonInteraction & MessageComponentInteraction;

const NOT_A_REVIEWER = `${getEmoji("error")} Only members with **Manage Server** or the reviewer role can review applications.`;

function createDecisionButton(decision: "approve" | "decline"): InteractionComponent {
	const approve = decision === "approve";

	return {
		customId: approve ? APPLICATION_APPROVE_BUTTON_ID : APPLICATION_DECLINE_BUTTON_ID,

		handler: async (interaction) => {
			const buttonInteraction = interaction as ReviewInteraction;
			const guildId = buttonInteraction.guild_id;
			if (!guildId) return;

			const config = await getApplicationConfig(guildId);

			if (!canReviewApplications(buttonInteraction.member, config)) {
				return buttonInteraction.reply({ content: NOT_A_REVIEWER, flags: InteractionFlags.Ephemeral });
			}

			const modal = new ModalBuilder()
				.setCustomId(approve ? APPLICATION_APPROVE_MODAL_ID : APPLICATION_DECLINE_MODAL_ID)
				.setTitle(approve ? "Approve Application" : "Reject Application")
				.addComponents(
					new LabelBuilder()
						.setLabel("Reason (Optional)")
						.setComponent(
							new TextInputBuilder()
								.setCustomId(APPLICATION_DECISION_NOTE_FIELD_ID)
								.setStyle(TextInputStyle.Paragraph)
								.setMaxLength(1500)
								.setRequired(false),
						),
					new LabelBuilder()
						.setLabel("Notify applicant via DM?")
						.setComponent(new CheckboxBuilder().setCustomId(APPLICATION_DECISION_NOTIFY_FIELD_ID)),
				);

			return buttonInteraction.showModal(modal);
		},
	};
}

/**
 * Posts a private note after the button was already acknowledged. `reply`
 * would overwrite the review message here, so this goes out as a follow-up.
 */
async function sendEphemeralNotice(interaction: ReviewInteraction, content: string) {
	await interaction.sendFollowUp?.(interaction.token, {
		type: InteractionResponseType.ChannelMessageWithSource,
		data: { content, flags: MessageFlags.Ephemeral },
	});
}

/** Switches the review message to another page of answers. */
function createTabButton(page: number): InteractionComponent {
	return {
		customId: applicationReviewTabId(page),

		handler: async (interaction) => {
			const buttonInteraction = interaction as ReviewInteraction;
			const guildId = buttonInteraction.guild_id;
			const message = buttonInteraction.message;
			if (!guildId || !message) return;

			// Acknowledge first, exactly like the form's submit button, and edit
			// afterwards. The reads below can take seconds on a cold instance, and
			// work left to the library's timed auto-defer was not finishing there.
			// An edit also throws Discord's real reason when it refuses the
			// message, which the fallback below relies on.
			const startedAt = Date.now();
			buttonInteraction.deferUpdate();

			const [config, record] = await Promise.all([
				getApplicationConfig(guildId),
				getApplicationRecord(message.id),
			]);
			console.log(`[application] Review tab ${page}: reads took ${Date.now() - startedAt}ms.`);

			if (!canReviewApplications(buttonInteraction.member, config)) {
				return sendEphemeralNotice(buttonInteraction, NOT_A_REVIEWER);
			}

			if (!record || record.guildId !== guildId || !record.pages[page - 1]) {
				return sendEphemeralNotice(
					buttonInteraction,
					`${getEmoji("error")} This application is not stored anymore.`,
				);
			}

			record.viewPage = page - 1;
			await saveApplicationRecord(message.id, record);

			// Listing the existing ids keeps the uploaded files on the message,
			// so every tab can keep pointing at them.
			const attachments = (message.attachments ?? []).map((attachment) => ({ id: attachment.id }));

			try {
				const response = await buttonInteraction.editReply({
					components: buildReviewComponents(record),
					attachments,
					allowed_mentions: { parse: [] },
				} as Parameters<ReviewInteraction["editReply"]>[0]);
				console.log(`[application] Review tab ${page}: shown in ${Date.now() - startedAt}ms.`);
				return response;
			} catch (error) {
				console.error(`[application] Failed to show review tab ${page} with inline files:`, error);
			}

			// Discord refused the inline previews: show the same page with the
			// uploaded files as plain links so the tab still works.
			const response = await buttonInteraction.editReply({
				components: buildReviewComponents(record, {
					attachmentLinks: reviewAttachmentLinks(message.attachments),
				}),
				attachments,
				allowed_mentions: { parse: [] },
			} as Parameters<ReviewInteraction["editReply"]>[0]);
			console.log(`[application] Review tab ${page}: shown with file links in ${Date.now() - startedAt}ms.`);
			return response;
		},
	};
}

function describeStatus(status: string | undefined) {
	switch (status) {
		case "approved":
			return `${getEmoji("seal")} Approved`;
		case "declined":
			return `${getEmoji("error")} Rejected`;
		case "pending":
			return `${getEmoji("timer")} Pending`;
		default:
			return "Unknown";
	}
}

const historyButton: InteractionComponent = {
	customId: APPLICATION_HISTORY_BUTTON_ID,

	handler: async (interaction) => {
		const buttonInteraction = interaction as ReviewInteraction;
		const guildId = buttonInteraction.guild_id;
		const message = buttonInteraction.message;
		if (!guildId || !message) return;

		const [config, record] = await Promise.all([
			getApplicationConfig(guildId),
			getApplicationRecord(message.id),
		]);

		if (!canReviewApplications(buttonInteraction.member, config)) {
			return buttonInteraction.reply({ content: NOT_A_REVIEWER, flags: InteractionFlags.Ephemeral });
		}

		if (!record || record.guildId !== guildId) {
			return buttonInteraction.reply({
				content: `${getEmoji("error")} This application is not stored anymore.`,
				flags: InteractionFlags.Ephemeral,
			});
		}

		const entries = (await getApplicationHistory(guildId, record.userId)).slice(0, 10);
		const records = await Promise.all(entries.map((entry) => getApplicationRecord(entry.messageId)));

		const lines = entries.map((entry, index) => {
			const link = `https://discord.com/channels/${guildId}/${entry.channelId}/${entry.messageId}`;
			const current = entry.messageId === message.id ? " • *this one*" : "";
			return (
				`**[#${entry.ref}](${link})** • ${entry.buttonLabel} • ${describeStatus(records[index]?.status)}\n` +
				`-# Submitted <t:${Math.floor(entry.submittedAt / 1000)}:R>${current}`
			);
		});

		const container = new ContainerBuilder()
			.addComponent(
				new TextDisplayBuilder().setContent(
					`## ${getEmoji("people")} Application History\n<@${record.userId}> (${record.userId})`,
				),
			)
			.addComponent(
				new TextDisplayBuilder().setContent(
					lines.length > 0 ? lines.join("\n") : "No applications recorded for this member yet.",
				),
			);

		return buttonInteraction.reply({
			components: [container.toJSON()],
			flags: [InteractionFlags.Ephemeral, InteractionFlags.IsComponentsV2],
			allowed_mentions: { parse: [] },
		} as Parameters<ReviewInteraction["reply"]>[0]);
	},
};

export default [
	createDecisionButton("approve"),
	createDecisionButton("decline"),
	...APPLICATION_PAGES.map(createTabButton),
	historyButton,
];
