import {
	CommandBuilder,
	CommandContext,
	ContainerBuilder,
	IntegrationType,
	InteractionFlags,
	TextDisplayBuilder,
} from "@minesa-org/mini-interaction";
import type {
	CommandInteraction,
	InteractionCommand,
} from "@minesa-org/mini-interaction";
import { getEmoji, sendAlertMessage } from "../utils/index.ts";
import {
	getUserOpenTickets,
	isTicketOpen,
	setCurrentTicketForUser,
} from "../utils/ticketControls.ts";
import { db } from "../utils/database.ts";

const switchTicketCommand: InteractionCommand = {
	data: new CommandBuilder()
		.setName("switch-ticket")
		.setDescription("Choose which active ticket /send should use in DMs")
		.setContexts([CommandContext.Bot])
		.setIntegrationTypes([
			IntegrationType.UserInstall,
			IntegrationType.GuildInstall,
		])
		.addStringOption((option) =>
			option
				.setName("ticket")
				.setDescription("Active ticket to make current")
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

		await interaction.deferReply({
			flags: [InteractionFlags.Ephemeral, InteractionFlags.IsComponentsV2],
		});

		const ticketId = interaction.options.getString("ticket", true)!;
		const ticketData = await db.get(`ticket:${ticketId}`).catch(() => null);

		if (!isTicketOpen(ticketData) || ticketData.userId !== user.id) {
			return sendAlertMessage({
				interaction,
				content: "That is not one of your active tickets.",
				type: "error",
			});
		}

		const { tickets } = await getUserOpenTickets(user.id);
		if (!tickets.some((ticket) => ticket.ticketId === ticketId)) {
			return sendAlertMessage({
				interaction,
				content: "That ticket is not active for your account.",
				type: "error",
			});
		}

		await setCurrentTicketForUser(user.id, ticketId);

		const container = new ContainerBuilder()
			.addComponent(
				new TextDisplayBuilder().setContent(
					`## ${getEmoji("ticket.circle.reopen")} Current ticket changed`,
				),
			)
			.addComponent(
				new TextDisplayBuilder().setContent(
					`/send in DMs will now go to **#${ticketData.caseNumber ?? ticketData.ticketId} - ${ticketData.title ?? "Ticket"}** in <#${ticketData.threadId}>.`,
				),
			);

		return interaction.editReply({
			components: [container],
		});
	},
};

export default switchTicketCommand;
