import { InteractionFlags, MessageFlags } from "@minesa-org/mini-interaction";
import { InteractionResponseType } from "discord-api-types/v10";
import type { APIInteractionResponse } from "discord-api-types/v10";
import type { InteractionModal, ModalSubmitInteraction } from "@minesa-org/mini-interaction";
import { getEmoji } from "../../utils/index.ts";
import { getInteractionUser } from "../../utils/ticketControls.ts";
import {
	APPLICATION_PAGES,
	applicationPageModalId,
	applicationQuestionFieldId,
	buildApplicationForm,
	buildFormNotice,
	getApplicationConfig,
	getApplicationDraft,
	sanitizeFilename,
	saveApplicationDraft,
} from "../../utils/application.ts";
import type { ApplicationAnswer, ApplicationQuestion } from "../../utils/application.ts";

function pickOptionLabels(question: ApplicationQuestion, values: string[]) {
	return values
		.map((value) => question.options[Number(value)])
		.filter((label): label is string => typeof label === "string");
}

function readAnswer(interaction: ModalSubmitInteraction, question: ApplicationQuestion, index: number, pageSlot: number) {
	const customId = applicationQuestionFieldId(index);

	switch (question.type) {
		case "paragraph":
			return { label: question.label, answer: interaction.getTextFieldValue(customId)?.trim() ?? "" };

		case "radio": {
			const value = interaction.getRadioGroupValue(customId);
			return {
				label: question.label,
				answer: value === undefined ? "" : (pickOptionLabels(question, [value])[0] ?? ""),
			};
		}

		case "checkbox": {
			if (question.options.length === 0) {
				return { label: question.label, answer: interaction.getCheckboxValue(customId) ? "Yes" : "No" };
			}

			const labels = pickOptionLabels(question, interaction.getCheckboxGroupValues(customId));
			return { label: question.label, answer: labels.map((label) => `• ${label}`).join("\n") };
		}

		case "attachment": {
			const attachment = interaction.getAttachment(customId);
			if (!attachment) return { label: question.label, answer: "" };

			// Only the upload's details are kept here; the file itself is
			// copied into the review message when the form is submitted.
			return {
				label: question.label,
				answer: `\`${attachment.filename}\``,
				upload: {
					url: attachment.url,
					filename: `p${pageSlot}q${index + 1}_${sanitizeFilename(attachment.filename, "file")}`,
					size: attachment.size,
					contentType: attachment.content_type ?? null,
				},
			};
		}
	}
}

/** Redraws the form message the modal was opened from. */
function updateForm(components: unknown[]) {
	return {
		type: InteractionResponseType.UpdateMessage,
		data: { components, flags: MessageFlags.IsComponentsV2 },
	} as unknown as APIInteractionResponse;
}

function createPageModal(pageSlot: number): InteractionModal {
	return {
		customId: applicationPageModalId(pageSlot),

		// Returning an UPDATE_MESSAGE response (instead of deferring) is what
		// lets the answers land on the existing form rather than a new message.
		handler: async (interaction) => {
			const guildId = interaction.guild_id;
			const user = getInteractionUser(interaction);
			if (!guildId || !user) return;

			const [config, draft] = await Promise.all([
				getApplicationConfig(guildId),
				getApplicationDraft(guildId, user.id),
			]);

			const button = draft ? config?.buttons[draft.slot - 1] : null;
			const page = button?.pages[pageSlot - 1];

			if (!draft || !button || !page) {
				return updateForm(
					buildFormNotice(
						`${getEmoji("error")} This form has expired. Press the application button again to start over.`,
					),
				);
			}

			// A lone checkbox cannot be marked required in the modal itself.
			const unconfirmed = page.questions.find(
				(question, index) =>
					question?.type === "checkbox" &&
					question.required &&
					question.options.length === 0 &&
					!interaction.getCheckboxValue(applicationQuestionFieldId(index)),
			);

			if (unconfirmed) {
				return interaction.reply({
					content: `${getEmoji("error")} You need to tick **${unconfirmed.label}** to continue. Open **${page.title}** again.`,
					flags: InteractionFlags.Ephemeral,
				});
			}

			const answers: ApplicationAnswer[] = [];
			page.questions.forEach((question, index) => {
				if (question) answers.push(readAnswer(interaction, question, index, pageSlot));
			});

			draft.pages[pageSlot - 1] = answers;
			await saveApplicationDraft(guildId, user.id, draft);

			return updateForm(buildApplicationForm(button, draft));
		},
	};
}

export default APPLICATION_PAGES.map(createPageModal);
