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
	buildCreateIssueModal,
	storePendingTicketCreate,
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
		])
		.addStringOption((option) =>
			option
				.setName("server")
				.setDescription("Server to create the ticket in")
				.setRequired(true)
				.setAutocomplete(true),
		),

	handler: async (interaction: CommandInteraction) => {
		const user = interaction.user ?? interaction.member?.user;

		if (!user) {
			return sendAlertMessage({
				interaction,
				content: "Could not resolve user.",
				type: "error",
			});
		}

		const guildId = interaction.options.getString("server", true)!;

		await storePendingTicketCreate({
			userId: user.id,
			guildId,
			guildName: "selected server",
		});

		return interaction.showModal(buildCreateIssueModal("selected server"));
	},
};

export default createCommand;
