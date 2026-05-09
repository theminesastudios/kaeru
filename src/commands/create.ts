import {
	CommandBuilder,
	CommandContext,
	IntegrationType,
} from "@minesa-org/mini-interaction";
import type {
	CommandInteraction,
	InteractionCommand,
} from "@minesa-org/mini-interaction";
import {
	deferCreateReply,
	showCreateServerSelect,
} from "../utils/createTicketFlow.ts";
import { sendAlertMessage } from "../utils/index.ts";

const createCommand: InteractionCommand = {
	data: new CommandBuilder()
		.setName("create")
		.setDescription("Create a ticket thread in a mutual server")
		.setContexts([CommandContext.Bot])
		.setIntegrationTypes([
			IntegrationType.UserInstall,
			IntegrationType.GuildInstall,
		]),

	handler: async (interaction: CommandInteraction) => {
		const user = interaction.user ?? interaction.member?.user;

		if (!user) {
			return sendAlertMessage({
				interaction,
				content: "Could not resolve user.",
				type: "error",
			});
		}

		await deferCreateReply(interaction);
		return showCreateServerSelect(interaction, user);
	},
};

export default createCommand;
