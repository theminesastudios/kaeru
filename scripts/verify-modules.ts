import assert from "node:assert/strict";
import type {
	InteractionComponent,
	InteractionCommand,
	InteractionModal,
} from "@minesa-org/mini-interaction";
import {
	PUNISH_MESSAGE_CUSTOM_REASON_MODAL_ID,
	PUNISH_MESSAGE_CUSTOM_REASON_VALUE,
	PUNISH_MESSAGE_REASON_SELECT_ID,
} from "../src/commands/punish-message.ts";

// MiniInteraction insists on REST credentials at construction time. These are
// throwaway placeholders because this smoke test never talks to Discord.
process.env.DISCORD_APPLICATION_ID ||= "0";
process.env.DISCORD_BOT_TOKEN ||= "placeholder";

// Importing the interaction entrypoint is the closest thing to a cold start:
// it builds the MiniInteraction instance the Vercel function uses.
const { mini } = await import("../api/interactions.ts");
assert.ok(mini, "api/interactions.ts must export the mini instance");

// Importing these catches anything that throws at module load, which is the
// failure mode that would otherwise only show up as a runtime 500.
const punishmentModule = (await import("../src/commands/punishment.ts")) as {
	default: InteractionCommand;
	PUNISHMENT_RULES_CHANNEL_SELECT_ID: string;
};

const punishMessageModule = (await import("../src/commands/punish-message.ts")) as {
	default: InteractionCommand;
};

const rulesChannelModule = (await import(
	"../src/components/selectMenus/punishment_rules_channel.ts"
)) as { default: InteractionComponent };

const reasonSelectModule = (await import(
	"../src/components/selectMenus/punish_message_reason.ts"
)) as { default: InteractionComponent };

const customReasonModalModule = (await import(
	"../src/components/modals/punish_message_custom_reason.ts"
)) as { default: InteractionModal };

const punishmentName = (
	(punishmentModule.default.data as { toJSON: () => { name: string } }).toJSON() as {
		name: string;
	}
).name;

assert.equal(punishmentName, "punishment", "the /punishment command must build");
assert.equal(
	rulesChannelModule.default.customId,
	punishmentModule.PUNISHMENT_RULES_CHANNEL_SELECT_ID,
	"the rules-channel select must use the id the command references",
);

// The context-menu select and modal must keep the ids the punish command emits,
// otherwise clicking the menu silently does nothing.
assert.equal(
	reasonSelectModule.default.customId,
	PUNISH_MESSAGE_REASON_SELECT_ID,
	"the reason select must use the id the command references",
);
assert.equal(
	customReasonModalModule.default.customId,
	PUNISH_MESSAGE_CUSTOM_REASON_MODAL_ID,
	"the custom-reason modal must expose the id the select opens",
);
assert.ok(
	!PUNISH_MESSAGE_CUSTOM_REASON_MODAL_ID.includes("/"),
	"modal custom ids must not contain a slash",
);
assert.equal(
	PUNISH_MESSAGE_REASON_SELECT_ID.includes(":"),
	true,
	"the select keeps the project's prefixed custom id style",
);

// Every component must expose a handler, otherwise the router would register a
// dead entry.
assert.equal(typeof rulesChannelModule.default.handler, "function");
assert.equal(typeof reasonSelectModule.default.handler, "function");
assert.equal(typeof customReasonModalModule.default.handler, "function");
assert.equal(typeof punishmentModule.default.handler, "function");
assert.equal(typeof punishMessageModule.default.handler, "function");

console.log("module smoke test passed");
