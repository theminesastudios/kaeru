import {
	ChannelType,
	CommandBuilder,
	CommandContext,
	ContainerBuilder,
	IntegrationType,
	InteractionFlags,
	LabelBuilder,
	MiniPermFlags,
	ModalBuilder,
	ModalChannelSelectMenuBuilder,
	ModalRoleSelectMenuBuilder,
	TextDisplayBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "@minesa-org/mini-interaction";
import type { CommandInteraction, InteractionCommand } from "@minesa-org/mini-interaction";
import { SelectMenuDefaultValueType } from "discord-api-types/v10";
import { fetchDiscord } from "../utils/discord.ts";
import { getEmoji, sendAlertMessage } from "../utils/index.ts";
import {
	APPLICATION_MAX_BUTTONS,
	APPLICATION_MAX_QUESTIONS,
	APPLICATION_SETUP_MODAL_ID,
	buildApplicationPanel,
	createEmptyApplicationConfig,
	deleteApplicationConfig,
	describeQuestionType,
	getActiveQuestions,
	getApplicationConfig,
	getPublishableButtons,
	parseQuestionOptions,
	saveApplicationConfig,
} from "../utils/application.ts";
import type { ApplicationQuestionType } from "../utils/application.ts";

// mini-interaction validates choice names with the command-name pattern, so
// they stay single lowercase words.
const QUESTION_TYPES: { name: string; value: ApplicationQuestionType }[] = [
	{ name: "paragraph", value: "paragraph" },
	{ name: "checkbox", value: "checkbox" },
	{ name: "radio", value: "radio" },
	{ name: "attachment", value: "attachment" },
];

const applicationCommand: InteractionCommand = {
	data: new CommandBuilder()
		.setName("application")
		.setDescription("Set up staff applications reviewed by your team")
		.setContexts([CommandContext.Guild])
		.setIntegrationTypes([IntegrationType.GuildInstall])
		.setDefaultMemberPermissions(MiniPermFlags.Administrator)
		.addSubcommand((sub) =>
			sub
				.setName("setup")
				.setDescription("Set the panel text, panel channel, review channel and reviewer role"),
		)
		.addSubcommand((sub) =>
			sub
				.setName("button")
				.setDescription("Create or rename one of the five application buttons")
				.addNumberOption((opt) =>
					opt
						.setName("button")
						.setDescription("Button slot")
						.setRequired(true)
						.setMinValue(1)
						.setMaxValue(APPLICATION_MAX_BUTTONS),
				)
				.addStringOption((opt) =>
					opt
						.setName("label")
						.setDescription("Button label, also used as the form title")
						.setRequired(true)
						.setMaxLength(45),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("question")
				.setDescription("Add or replace a question on an application button")
				.addNumberOption((opt) =>
					opt
						.setName("button")
						.setDescription("Button slot the question belongs to")
						.setRequired(true)
						.setMinValue(1)
						.setMaxValue(APPLICATION_MAX_BUTTONS),
				)
				.addNumberOption((opt) =>
					opt
						.setName("slot")
						.setDescription("Question position in the form")
						.setRequired(true)
						.setMinValue(1)
						.setMaxValue(APPLICATION_MAX_QUESTIONS),
				)
				.addStringOption((opt) =>
					opt
						.setName("type")
						.setDescription("paragraph = long text, checkbox = pick any, radio = pick one, attachment = file")
						.setRequired(true)
						.addChoices(...QUESTION_TYPES),
				)
				.addStringOption((opt) =>
					opt
						.setName("question")
						.setDescription("The question itself")
						.setRequired(true)
						.setMaxLength(45),
				)
				.addStringOption((opt) =>
					opt
						.setName("description")
						.setDescription("Extra hint shown under the question")
						.setMaxLength(100),
				)
				.addStringOption((opt) =>
					opt
						.setName("options")
						.setDescription("Checkbox/radio choices, separated by commas (or | if labels have commas)")
						.setMaxLength(1000),
				)
				.addStringOption((opt) =>
					opt
						.setName("required")
						.setDescription("Whether an answer is required (default: yes)")
						.addChoices({ name: "yes", value: "yes" }, { name: "no", value: "no" }),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("remove")
				.setDescription("Remove a whole button, or one of its questions")
				.addNumberOption((opt) =>
					opt
						.setName("button")
						.setDescription("Button slot")
						.setRequired(true)
						.setMinValue(1)
						.setMaxValue(APPLICATION_MAX_BUTTONS),
				)
				.addNumberOption((opt) =>
					opt
						.setName("question")
						.setDescription("Question slot; leave empty to remove the whole button")
						.setMinValue(1)
						.setMaxValue(APPLICATION_MAX_QUESTIONS),
				),
		)
		.addSubcommand((sub) =>
			sub.setName("details").setDescription("View the current application setup"),
		)
		.addSubcommand((sub) =>
			sub
				.setName("publish")
				.setDescription("Send the application panel, or refresh the one already sent"),
		)
		.addSubcommand((sub) =>
			sub.setName("reset").setDescription("Delete the whole application setup"),
		),

	handler: async (interaction: CommandInteraction) => {
		const guild = interaction.guild;
		if (!guild) {
			return sendAlertMessage({
				interaction,
				content: "This command can only be used within a server.",
				type: "error",
			});
		}

		const subcommand = interaction.options.getSubcommand();

		if (subcommand === "setup") {
			const config = await getApplicationConfig(guild.id);

			const modal = new ModalBuilder()
				.setCustomId(APPLICATION_SETUP_MODAL_ID)
				.setTitle("Application Setup")
				.addComponents(
					new LabelBuilder()
						.setLabel("Panel Title")
						.setComponent(
							new TextInputBuilder()
								.setCustomId("title")
								.setStyle(TextInputStyle.Short)
								.setMaxLength(100)
								.setRequired(true)
								.setValue(config?.title ?? "Staff Applications"),
						),
					new LabelBuilder()
						.setLabel("Panel Description")
						.setDescription("Shown above the application buttons. Markdown is supported")
						.setComponent(
							new TextInputBuilder()
								.setCustomId("description")
								.setStyle(TextInputStyle.Paragraph)
								.setMaxLength(2000)
								.setRequired(false)
								.setValue(config?.description ?? ""),
						),
					new LabelBuilder()
						.setLabel("Panel Channel")
						.setDescription("Where members find the application buttons")
						.setComponent(
							withDefaultChannel(
								new ModalChannelSelectMenuBuilder()
									.setCustomId("panel-channel")
									.setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement])
									.setMinValues(1)
									.setMaxValues(1),
								config?.panelChannelId,
							),
						),
					new LabelBuilder()
						.setLabel("Review Channel")
						.setDescription("Every submitted application is sent here with Approve / Decline")
						.setComponent(
							withDefaultChannel(
								new ModalChannelSelectMenuBuilder()
									.setCustomId("review-channel")
									.setChannelTypes([ChannelType.GuildText])
									.setMinValues(1)
									.setMaxValues(1),
								config?.reviewChannelId,
							),
						),
					new LabelBuilder()
						.setLabel("Reviewer Role")
						.setDescription("Optional. Members with Manage Server can always review")
						.setComponent(
							withDefaultRole(
								new ModalRoleSelectMenuBuilder()
									.setCustomId("reviewer-role")
									.setMinValues(0)
									.setMaxValues(1)
									.setRequired(false),
								config?.reviewerRoleId,
							),
						),
				);

			return interaction.showModal(modal);
		}

		// The details view is a Components V2 container, and that flag has to be
		// set when deferring; it cannot be added on the edit.
		await interaction.deferReply({
			flags:
				subcommand === "details"
					? [InteractionFlags.Ephemeral, InteractionFlags.IsComponentsV2]
					: InteractionFlags.Ephemeral,
		});

		if (subcommand === "button") {
			const slot = interaction.options.getNumber("button", true)!;
			const label = interaction.options.getString("label", true)!.trim();
			const config = (await getApplicationConfig(guild.id)) ?? createEmptyApplicationConfig(guild.id);

			const existing = config.buttons[slot - 1];
			config.buttons[slot - 1] = {
				label,
				questions: existing?.questions ?? Array.from({ length: APPLICATION_MAX_QUESTIONS }, () => null),
			};

			await saveApplicationConfig(config);

			return interaction.editReply({
				content:
					`${getEmoji("seal")} Button **${slot}** is now **${label}**.` +
					(existing ? "" : `\nAdd questions with \`/application question button:${slot}\`.`) +
					publishHint(config),
			});
		}

		if (subcommand === "question") {
			const slot = interaction.options.getNumber("button", true)!;
			const questionSlot = interaction.options.getNumber("slot", true)!;
			const type = interaction.options.getString("type", true) as ApplicationQuestionType;
			const label = interaction.options.getString("question", true)!.trim();
			const description = interaction.options.getString("description")?.trim() || undefined;
			const options = parseQuestionOptions(interaction.options.getString("options"));
			const required = interaction.options.getString("required") !== "no";

			const config = await getApplicationConfig(guild.id);
			const button = config?.buttons[slot - 1];

			if (!config || !button) {
				return interaction.editReply({
					content: `${getEmoji("error")} Button **${slot}** does not exist yet. Create it with \`/application button button:${slot}\` first.`,
				});
			}

			if (type === "radio" && (options.length < 2 || options.length > 10)) {
				return interaction.editReply({
					content: `${getEmoji("error")} Radio questions need between **2 and 10** options, e.g. \`Yes, No, Maybe\`.`,
				});
			}

			if (type === "checkbox" && (options.length === 1 || options.length > 10)) {
				return interaction.editReply({
					content: `${getEmoji("error")} Checkbox questions need between **2 and 10** options. Leave options empty for a single confirmation box.`,
				});
			}

			button.questions[questionSlot - 1] = {
				type,
				label,
				description,
				options: type === "radio" || type === "checkbox" ? options : [],
				required,
			};

			await saveApplicationConfig(config);

			return interaction.editReply({
				content:
					`${getEmoji("seal")} Question **${questionSlot}** on **${button.label}** saved as a ${describeQuestionType(
						type,
					).toLowerCase()} question.` + publishHint(config),
			});
		}

		if (subcommand === "remove") {
			const slot = interaction.options.getNumber("button", true)!;
			const questionSlot = interaction.options.getNumber("question");
			const config = await getApplicationConfig(guild.id);
			const button = config?.buttons[slot - 1];

			if (!config || !button) {
				return interaction.editReply({
					content: `${getEmoji("error")} Button **${slot}** is not set up.`,
				});
			}

			if (questionSlot) {
				if (!button.questions[questionSlot - 1]) {
					return interaction.editReply({
						content: `${getEmoji("error")} **${button.label}** has no question in slot **${questionSlot}**.`,
					});
				}

				button.questions[questionSlot - 1] = null;
				await saveApplicationConfig(config);

				return interaction.editReply({
					content: `${getEmoji("seal")} Removed question **${questionSlot}** from **${button.label}**.` + publishHint(config),
				});
			}

			config.buttons[slot - 1] = null;
			await saveApplicationConfig(config);

			return interaction.editReply({
				content: `${getEmoji("seal")} Removed the **${button.label}** button.` + publishHint(config),
			});
		}

		if (subcommand === "details") {
			const config = await getApplicationConfig(guild.id);
			if (!config) {
				return interaction.editReply({
					content: "No application setup found. Start with `/application setup`.",
				});
			}

			const buttonLines = config.buttons.map((button, index) => {
				if (!button) return `**${index + 1}.** *empty*`;

				const questions = getActiveQuestions(button);
				const questionLines = button.questions
					.map((question, questionIndex) => {
						if (!question) return null;
						const extras = [
							describeQuestionType(question.type),
							question.required ? "required" : "optional",
							question.options.length > 0 ? question.options.join(", ") : null,
						]
							.filter(Boolean)
							.join(" • ");
						return `  - ${questionIndex + 1}. ${question.label} — *${extras}*`;
					})
					.filter(Boolean);

				return (
					`**${index + 1}. ${button.label}** — ${questions.length}/${APPLICATION_MAX_QUESTIONS} questions` +
					(questionLines.length > 0 ? `\n${questionLines.join("\n")}` : "")
				);
			});

			const container = new ContainerBuilder()
				.addComponent(
					new TextDisplayBuilder().setContent(`## ${getEmoji("document")} Application Setup`),
				)
				.addComponent(
					new TextDisplayBuilder().setContent(
						`- **Title:** ${config.title}\n` +
							`- **Panel Channel:** ${config.panelChannelId ? `<#${config.panelChannelId}>` : "Not set"}\n` +
							`- **Review Channel:** ${config.reviewChannelId ? `<#${config.reviewChannelId}>` : "Not set"}\n` +
							`- **Reviewer Role:** ${config.reviewerRoleId ? `<@&${config.reviewerRoleId}>` : "Manage Server only"}\n` +
							`- **Published:** ${
								config.panelMessageId && config.panelMessageChannelId
									? `https://discord.com/channels/${guild.id}/${config.panelMessageChannelId}/${config.panelMessageId}`
									: "No"
							}`,
					),
				)
				.addComponent(new TextDisplayBuilder().setContent(buttonLines.join("\n").slice(0, 3500)));

			return interaction.editReply({ components: [container] });
		}

		if (subcommand === "publish") {
			const config = await getApplicationConfig(guild.id);

			if (!config?.panelChannelId || !config.reviewChannelId) {
				return interaction.editReply({
					content: `${getEmoji("error")} Set the panel and review channels with \`/application setup\` first.`,
				});
			}

			if (getPublishableButtons(config).length === 0) {
				return interaction.editReply({
					content: `${getEmoji("error")} Add at least one button with a question before publishing.`,
				});
			}

			const payload = buildApplicationPanel(config);
			const token = process.env.DISCORD_BOT_TOKEN!;

			// Refresh the existing panel in place when it is still in the
			// configured channel, so links and pins to it keep working.
			if (config.panelMessageId && config.panelMessageChannelId === config.panelChannelId) {
				try {
					await fetchDiscord(
						`/channels/${config.panelChannelId}/messages/${config.panelMessageId}`,
						token,
						true,
						"PATCH",
						payload,
					);

					return interaction.editReply({
						content: `${getEmoji("seal")} Refreshed the application panel in <#${config.panelChannelId}>.`,
					});
				} catch (error) {
					console.warn("[application] Panel refresh failed, sending a new one:", error);
				}
			}

			try {
				const message = await fetchDiscord(
					`/channels/${config.panelChannelId}/messages`,
					token,
					true,
					"POST",
					payload,
				);

				config.panelMessageId = message.id;
				config.panelMessageChannelId = config.panelChannelId;
				await saveApplicationConfig(config);

				return interaction.editReply({
					content: `${getEmoji("seal")} Application panel sent to <#${config.panelChannelId}>.`,
				});
			} catch (error) {
				console.error("[application] Failed to publish panel:", error);
				return interaction.editReply({
					content: `${getEmoji("error")} I could not send the panel. Check that I can view and send messages in <#${config.panelChannelId}>.`,
				});
			}
		}

		if (subcommand === "reset") {
			await deleteApplicationConfig(guild.id);
			return interaction.editReply({
				content: `${getEmoji("seal")} Application setup deleted. A panel that was already sent will stop accepting applications.`,
			});
		}
	},
};

function withDefaultChannel(menu: ModalChannelSelectMenuBuilder, channelId: string | null | undefined) {
	return channelId ? menu.setDefaultValues([{ id: channelId, type: SelectMenuDefaultValueType.Channel }]) : menu;
}

function withDefaultRole(menu: ModalRoleSelectMenuBuilder, roleId: string | null | undefined) {
	return roleId ? menu.setDefaultValues([{ id: roleId, type: SelectMenuDefaultValueType.Role }]) : menu;
}

function publishHint(config: { panelMessageId: string | null }) {
	return config.panelMessageId ? "\n-# Run `/application publish` to update the live panel." : "";
}

export default applicationCommand;
