import assert from "node:assert/strict";
import type {
	InteractionComponent,
	InteractionCommand,
	InteractionModal,
} from "@minesa-org/mini-interaction";

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

const rulesChannelModule = (await import(
	"../src/components/selectMenus/punishment_rules_channel.ts"
)) as { default: InteractionComponent };

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

// Every component must expose a handler, otherwise the router would register a
// dead entry.
assert.equal(typeof rulesChannelModule.default.handler, "function");
assert.equal(typeof punishmentModule.default.handler, "function");

console.log("module smoke test passed");
