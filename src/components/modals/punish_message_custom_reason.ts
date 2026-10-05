import { InteractionFlags } from "@minesa-org/mini-interaction";
import type { InteractionModal, ModalSubmitInteraction } from "@minesa-org/mini-interaction";
import { PUNISH_MESSAGE_CUSTOM_REASON_MODAL_ID, punishFlaggedMessage } from "../../commands/punish-message.ts";
import { getEmoji } from "../../utils/index.ts";

const punishMessageCustomReasonModal: InteractionModal = {
	customId: PUNISH_MESSAGE_CUSTOM_REASON_MODAL_ID,

	handler: async (interaction: ModalSubmitInteraction) => {
		const moderatorId = interaction.user?.id ?? interaction.member?.user?.id;
		const reason = interaction.getTextFieldValue("punishment:custom_reason")?.trim();

		if (!moderatorId || !reason) {
			return interaction.reply({
				content: `${getEmoji("error")} A reason is required.`,
				flags: InteractionFlags.Ephemeral,
			});
		}

		await interaction.deferReply({
			flags: InteractionFlags.Ephemeral | InteractionFlags.IsComponentsV2,
		});

		await punishFlaggedMessage({ moderatorId, reason, interaction });
	},
};

export default punishMessageCustomReasonModal;
