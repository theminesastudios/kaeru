import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MiniPermFlags } from "@minesa-org/mini-interaction";

import punishmentCommand from "../src/commands/punishment.ts";
import {
	PUNISHMENT_DEFAULT_CONFIG,
	buildCaseId,
	buildMemberRecordContainer,
	buildPunishmentDmContainer,
	buildPunishmentLogContainer,
	buildPunishmentResultContainer,
	buildScoreProgressBar,
	countActiveCases,
	extractMessageTextFromMessage,
	fetchRulesChannelText,
	isForgiven,
	resolvePunishmentPlan,
} from "../src/utils/punishment.ts";
import type {
	PunishmentCase,
	PunishmentConfig,
	PunishmentMemberRecord,
} from "../src/utils/punishment.ts";

const config: PunishmentConfig = {
	rulesChannelId: "111",
	reasons: [],
	pointsPerCase: PUNISHMENT_DEFAULT_CONFIG.pointsPerCase,
	kickThreshold: PUNISHMENT_DEFAULT_CONFIG.kickThreshold,
	banThreshold: PUNISHMENT_DEFAULT_CONFIG.banThreshold,
	timeoutLadderMs: [...PUNISHMENT_DEFAULT_CONFIG.timeoutLadderMs],
	setUpAt: 0,
};

function makeCase(overrides: Partial<PunishmentCase> = {}): PunishmentCase {
	caseCounter += 1;
	return {
		id: `case-${caseCounter}`,
		reason: "Spam",
		action: "timeout",
		points: 5,
		moderatorId: "mod-1",
		createdAt: Date.now(),
		...overrides,
	};
}

function makeRecord(cases: PunishmentCase[] = []): PunishmentMemberRecord {
	return {
		guildId: "1",
		userId: "2",
		score: cases
			.filter((entry) => !isForgiven(entry))
			.reduce((total, entry) => total + entry.points, 0),
		totalPoints: cases.reduce((total, entry) => total + entry.points, 0),
		cases,
		updatedAt: 0,
	};
}

let caseCounter = 0;

/**
 * Collects every message jump link in a rendered payload. Comparing the exact
 * links is a stricter check than a substring match, and avoids asserting on a
 * raw URL with `String.includes`.
 */
function findJumpLinks(payload: unknown): string[] {
	const links: string[] = [];

	const walk = (value: unknown) => {
		if (typeof value === "string") {
			for (const match of value.matchAll(/https:\/\/discord\.com\/channels\/[^\s)\]]+/g)) {
				links.push(match[0]);
			}
			return;
		}
		if (Array.isArray(value)) {
			value.forEach(walk);
			return;
		}
		if (value && typeof value === "object") {
			Object.values(value).forEach(walk);
		}
	};

	walk(payload);
	return links;
}

// --- 1. Command payload -----------------------------------------------------
const payload = (
	(punishmentCommand.data as { toJSON: () => unknown }).toJSON() as Record<string, any>
);
assert.equal(payload.name, "punishment");
assert.ok(payload.default_member_permissions, "command must be permission gated");
const perms = BigInt(payload.default_member_permissions);
const expectedPerms =
	MiniPermFlags.KickMembers | MiniPermFlags.BanMembers | MiniPermFlags.ModerateMembers;
assert.equal(perms, expectedPerms, "must require exactly Kick + Ban + Moderate members");
assert.ok((perms & MiniPermFlags.KickMembers) === MiniPermFlags.KickMembers, "Kick Members required");
assert.ok((perms & MiniPermFlags.BanMembers) === MiniPermFlags.BanMembers, "Ban Members required");
assert.ok(
	(perms & MiniPermFlags.ModerateMembers) === MiniPermFlags.ModerateMembers,
	"Moderate Members required",
);
assert.equal(
	(perms & MiniPermFlags.Administrator) === 0n,
	true,
	"Administrator must not be required",
);

const subcommands = payload.options.map((option: any) => option.name).sort();
assert.deepEqual(subcommands, ["forgive", "member", "setup", "view"]);

for (const subcommand of payload.options) {
	for (const option of subcommand.options ?? []) {
		assert.ok(
			option.description.length <= 100,
			`description too long on ${subcommand.name}.${option.name}`,
		);
		assert.ok(
			/^[-_\p{L}\p{N}]+$/u.test(option.name),
			`invalid option name ${option.name}`,
		);
	}
}
assert.equal(payload.description.length <= 100, true);

// --- 2. Escalation ladder ---------------------------------------------------
const step = (cases: PunishmentCase[], index: number) =>
	resolvePunishmentPlan({ record: makeRecord(cases), config, points: config.pointsPerCase });

let cases: PunishmentCase[] = [];
let plan = step(cases, 1);
assert.equal(plan.action, "timeout", "first case is a timeout");
assert.equal(plan.durationMs, 60 * 60 * 1000, "first timeout is 1h");

cases = [...cases, makeCase({ action: "timeout", points: plan.scoreAfter - plan.scoreBefore })];
plan = step(cases, 2);
assert.equal(plan.action, "timeout", "second case is still a timeout");
assert.equal(plan.durationMs, 6 * 60 * 60 * 1000, "second timeout escalates to 6h");

cases = [...cases, makeCase({ action: "timeout", points: plan.scoreAfter - plan.scoreBefore })];
plan = step(cases, 3);
assert.equal(plan.action, "kick", "hitting the kick threshold kicks");
assert.equal(plan.durationMs, null, "kicks have no timeout duration");

cases = [...cases, makeCase({ action: "kick", points: plan.scoreAfter - plan.scoreBefore })];
plan = step(cases, 4);
assert.equal(plan.action, "ban", "hitting the ban threshold bans");
assert.equal(plan.scoreAfter, config.banThreshold);

// The full ladder in one pass: 1h timeout, 6h timeout, kick, ban.
const ladder: string[] = [];
let walk = makeRecord([]);
for (let i = 0; i < 4; i += 1) {
	const step1 = resolvePunishmentPlan({ record: walk, config, points: config.pointsPerCase });
	ladder.push(
		step1.action === "timeout" ? `${step1.action}:${Math.round((step1.durationMs ?? 0) / 3_600_000)}h` : step1.action,
	);
	walk = {
		...walk,
		score: step1.scoreAfter,
		cases: [
			...walk.cases,
			makeCase({
				action: step1.action,
				durationMs: step1.durationMs,
				points: step1.scoreAfter - step1.scoreBefore,
			}),
		],
	};
}
assert.deepEqual(ladder, ["timeout:1h", "timeout:6h", "kick", "ban"]);

// Forgiving a case lowers the score and drops the ladder back down.
const forgiven = { ...cases[0], forgivenAt: Date.now(), forgivenBy: "mod-2" };
const afterForgive = makeRecord([forgiven, cases[1], cases[2]]);
assert.equal(afterForgive.score, 10, "forgiving removes that case's points");
assert.equal(countActiveCases(afterForgive), 2);
const forgivenPlan = resolvePunishmentPlan({
	record: afterForgive,
	config,
	points: config.pointsPerCase,
});
assert.equal(forgivenPlan.action, "kick", "score 10 + 5 still kicks");

const droppedPlan = resolvePunishmentPlan({
	record: makeRecord([forgiven, cases[1]]),
	config,
	points: config.pointsPerCase,
});
assert.equal(droppedPlan.action, "timeout", "score 5 + 5 drops back to a timeout");

const atBan = resolvePunishmentPlan({
	record: makeRecord([cases[0], cases[1], cases[2]]),
	config,
	points: config.pointsPerCase,
});
assert.equal(atBan.action, "ban", "3 active cases (15 pts) + 5 reaches the ban threshold");

// Manual override still works.
assert.equal(
	resolvePunishmentPlan({
		record: makeRecord([]),
		config,
		points: config.pointsPerCase,
		requestedAction: "ban",
	}).action,
	"ban",
);

// Timeout duration is clamped to Discord's 28 day maximum.
const clamped = resolvePunishmentPlan({
	record: makeRecord([]),
	config,
	points: 1,
	requestedAction: "timeout",
	requestedDurationMs: 400 * 24 * 60 * 60 * 1000,
});
assert.equal(clamped.durationMs, 28 * 24 * 60 * 60 * 1000);

// --- 3. Progress bar --------------------------------------------------------
// Case ids end up inside markdown code quotes, so they must stay alphanumeric.
const generatedIds = new Set(Array.from({ length: 500 }, () => buildCaseId()));
assert.equal(generatedIds.size, 500, "case ids must not collide");
assert.ok(
	[...generatedIds].every((id) => /^[a-z0-9]{6,}$/.test(id)),
	"case ids must be lowercase alphanumeric so they are safe inside code quotes",
);

assert.equal(buildScoreProgressBar(0, 20, 12), "\u2591".repeat(12));
assert.equal(buildScoreProgressBar(20, 20, 12), "\u2588".repeat(12));
assert.equal(buildScoreProgressBar(10, 20, 12), "\u2588".repeat(6) + "\u2591".repeat(6));
assert.equal(
	buildScoreProgressBar(999, 20, 12).length,
	12,
	"score above the ban threshold does not overflow the bar",
);

// --- 4. ComponentsV2 payloads ----------------------------------------------
const punishPlan = resolvePunishmentPlan({
	record: makeRecord([]),
	config,
	points: config.pointsPerCase,
});
const punishCase = makeCase();
const record = makeRecord([punishCase]);

const containers = {
	dm: buildPunishmentDmContainer({
		guildName: "Test Guild",
		guildId: "1",
		targetUserId: "2",
		plan: punishPlan,
		reason: "Spam — flooding chat",
		moderatorId: "mod-1",
		score: 5,
		config,
	}),
	log: buildPunishmentLogContainer({
		guildName: "Test Guild",
		guildId: "1",
		targetUserId: "2",
		plan: punishPlan,
		reason: "Spam — flooding chat",
		moderatorId: "mod-1",
		score: 5,
		config,
		caseId: punishCase.id,
		channelId: "9",
		messageId: "10",
	}),
	result: buildPunishmentResultContainer({
		targetUserId: "2",
		plan: punishPlan,
		reason: "Spam — flooding chat",
		score: 5,
		config,
		record,
		dmSent: true,
		guildName: "Test Guild",
	}),
	view: buildMemberRecordContainer({
		guildName: "Test Guild",
		guildId: "1",
		targetUserId: "2",
		targetTag: "spammer",
		record,
		config,
	}),
};

for (const [name, container] of Object.entries(containers)) {
	const json = container.toJSON();
	assert.equal(json.type, 17, `${name} must be a container component`);
	assert.ok(json.components.length > 0, `${name} must have components`);
	assert.ok(typeof json.accent_color === "number", `${name} must have an accent colour`);

	const serialized = JSON.stringify(json);
	assert.ok(!serialized.includes("undefined"), `${name} leaked "undefined" into the payload`);
	assert.ok(!serialized.includes("NaN"), `${name} leaked "NaN" into the payload`);

	for (const component of json.components) {
		if (component.type === 10) {
			assert.ok(component.content.length > 0, `${name} has an empty text display`);
			assert.ok(
				component.content.length <= 4000,
				`${name} text display exceeds Discord's 4000 char limit`,
			);
		}
	}
}

const dmText = JSON.stringify(containers.dm.toJSON());
assert.ok(dmText.includes("Spam"), "DM shows the reason");
assert.ok(dmText.includes("5"), "DM shows the score");

const logText = JSON.stringify(containers.log.toJSON());
assert.deepEqual(
	findJumpLinks(containers.log.toJSON()),
	["https://discord.com/channels/1/9/10"],
	"log shows exactly one jump link to the offending message",
);
assert.ok(logText.includes(punishCase.id), "log shows the case id");

const viewText = JSON.stringify(containers.view.toJSON());
assert.ok(viewText.includes(punishCase.reason), "view lists the case reason");
assert.ok(viewText.includes(punishCase.id), "view lists the case id");

const cleanViewText = JSON.stringify(
	buildMemberRecordContainer({
		guildName: "Test Guild",
		guildId: "1",
		targetUserId: "3",
		record: makeRecord([]),
		config,
	}).toJSON(),
);
assert.ok(cleanViewText.includes("clean record"), "view handles members with no cases");

// --- 5. Message context menu surface ---------------------------------------
const punishMessageModule = await import("../src/commands/punish-message.ts");
const punishMessage = punishMessageModule.default;
const {
	PUNISH_MESSAGE_CUSTOM_REASON_VALUE,
	buildMessagePunishPromptContainer,
	buildMessagePunishReasonOptions,
} = punishMessageModule;
const punishMessagePayload = (
	(punishMessage.data as { toJSON: () => unknown }).toJSON() as Record<string, any>
);

assert.equal(punishMessagePayload.name, "Punish Message");
assert.equal(punishMessagePayload.type, 3, "must be a Message context menu command");
// Context menus live outside the guild only when their context allows it, and a
// punishment is meaningless in DMs.
assert.deepEqual(punishMessagePayload.contexts, [0], "guild context only");
assert.deepEqual(punishMessagePayload.integration_types, [0], "guild install only");

const menuPerms = BigInt(punishMessagePayload.default_member_permissions);
const menuExpected =
	MiniPermFlags.KickMembers | MiniPermFlags.BanMembers | MiniPermFlags.ModerateMembers;
assert.equal(menuPerms, menuExpected, "context menu must require the same permissions");
assert.ok(punishMessagePayload.name.length <= 32, "context menu names cap at 32 characters");

// Prepared reasons must always leave room for the custom-reason escape hatch.
const manyReasons: PunishmentConfig = {
	...config,
	reasons: Array.from({ length: 40 }, (_, index) => ({
		id: `r${index}`,
		title: `Reason ${index}`,
		detail: `Detail ${index}`,
	})),
};
const options = buildMessagePunishReasonOptions(manyReasons);
assert.equal(options.length, 25, "Discord allows at most 25 select options");
assert.equal(
	options[options.length - 1].value,
	PUNISH_MESSAGE_CUSTOM_REASON_VALUE,
	"the custom reason option must always be present",
);
assert.equal(
	options.filter((option) => option.label.length > 100).length,
	0,
	"select option labels must fit Discord's 100 char limit",
);

assert.equal(
	buildMessagePunishReasonOptions(config).length,
	1,
	"a server with no prepared reasons still gets the custom option",
);

// The prompt container must serialise with and without message text, and must
// link back to the offending message.
const pending = {
	guildId: "1",
	guildName: "Test Guild",
	channelId: "9",
	messageId: "10",
	targetUserId: "2",
	targetTag: "spammer",
	preview: "buy my thing",
	createdAt: Date.now(),
};

const promptContainer = buildMessagePunishPromptContainer({
	pending,
	record: makeRecord([punishCase]),
	config,
}).toJSON();
assert.deepEqual(
	findJumpLinks(promptContainer),
	["https://discord.com/channels/1/9/10"],
	"prompt links to exactly the flagged message",
);
assert.ok(JSON.stringify(promptContainer).includes("buy my thing"), "prompt quotes the message");

const emptyPromptText = JSON.stringify(
	buildMessagePunishPromptContainer({
		pending: { ...pending, preview: "" },
		record: makeRecord([]),
		config,
	}).toJSON(),
);
assert.ok(emptyPromptText.includes("no readable text"), "prompt handles an empty message");

// Message text extraction: plain content, embeds and ComponentsV2 containers.
const extracted = extractMessageTextFromMessage({
	content: "plain message",
	embeds: [{ title: "Embed title", description: "Embed body", fields: [{ name: "Rule", value: "Be nice" }] }],
	components: [
		{
			type: 17, // container
			components: [{ type: 10, content: "Rules inside a container" }],
		},
	],
});
assert.ok(extracted.includes("plain message"));
assert.ok(extracted.includes("Embed title"));
assert.ok(extracted.includes("Embed body"));
assert.ok(extracted.includes("Rule: Be nice"));
assert.ok(
	extracted.includes("Rules inside a container"),
	"text inside a ComponentsV2 container must be extracted",
);

// `/punishment setup` reads the rules channel with `fetchDiscord`, whose third
// parameter (`isBot`) defaults to false and therefore sends `Bearer <token>`.
// Discord answers 401 and every setup run failed, so assert the read really
// authenticates as the bot instead of only asserting the shape of the code.
const realFetch = globalThis.fetch;
const realBotToken = process.env.DISCORD_BOT_TOKEN;
const authHeaders: string[] = [];

process.env.DISCORD_BOT_TOKEN = "test-bot-token";
globalThis.fetch = (async (_input: unknown, init?: { headers?: Record<string, string> }) => {
	authHeaders.push(init?.headers?.Authorization ?? "");
	return new Response(
		JSON.stringify([{ id: "1", content: "Rule 1: no harassment." }]),
		{ status: 200, headers: { "Content-Type": "application/json" } },
	);
}) as typeof fetch;

let scrapedRules = "";
try {
	scrapedRules = await fetchRulesChannelText("999");
} finally {
	globalThis.fetch = realFetch;
	if (realBotToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
	else process.env.DISCORD_BOT_TOKEN = realBotToken;
}

assert.ok(scrapedRules.includes("no harassment"), "rules read returns the channel text");
assert.ok(
	authHeaders.length > 0 && authHeaders.every((header) => header === "Bot test-bot-token"),
	`every rules read must authenticate as the bot, saw: ${JSON.stringify(authHeaders)}`,
);

// Static guard for the rest of the call sites: a `fetchDiscord(...)` call that
// forgets the `isBot` flag is a 401 waiting to happen, so require all of them.
const botAuthCallSites = [
	"src/utils/punishment.ts",
	"src/commands/punish-message.ts",
];

function splitTopLevelArgs(argumentList: string): string[] {
	const args: string[] = [];
	let depth = 0;
	let current = "";
	let quote: string | null = null;

	for (const character of argumentList) {
		if (quote) {
			current += character;
			if (character === quote) quote = null;
			continue;
		}

		if (character === '"' || character === "'" || character === "`") {
			quote = character;
			current += character;
			continue;
		}

		if (character === "(" || character === "{" || character === "[") depth++;
		else if (character === ")" || character === "}" || character === "]") depth--;

		if (character === "," && depth === 0) {
			args.push(current);
			current = "";
			continue;
		}

		current += character;
	}

	if (current.trim()) args.push(current);
	return args;
}

for (const relativePath of botAuthCallSites) {
	const source = readFileSync(new URL(relativePath, new URL("../", import.meta.url)), "utf8");
	const unauthenticated: string[] = [];
	let cursor = source.indexOf("fetchDiscord(");

	while (cursor !== -1) {
		const open = cursor + "fetchDiscord(".length;
		// Start at 1: the call's own opening paren has already been consumed.
		let depth = 1;
		let end = open;

		for (; end < source.length; end++) {
			const character = source[end];
			if (character === "(") depth++;
			else if (character === ")" && --depth === 0) break;
		}

		const thirdArgument = splitTopLevelArgs(source.slice(open, end))[2]?.trim();
		if (thirdArgument !== "true") {
			unauthenticated.push(
				`${relativePath}: ${source.slice(cursor, end + 1).replace(/\s+/g, " ")}`,
			);
		}

		cursor = source.indexOf("fetchDiscord(", end + 1);
	}

	assert.equal(
		unauthenticated.length,
		0,
		`fetchDiscord needs isBot=true (got: ${unauthenticated.join(" | ")})`,
	);
}

console.log("punishment verification passed");
