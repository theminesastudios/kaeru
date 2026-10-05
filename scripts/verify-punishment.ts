import assert from "node:assert/strict";
import { MiniPermFlags } from "@minesa-org/mini-interaction";

import punishmentCommand from "../src/commands/punishment.ts";
import {
	PUNISHMENT_DEFAULT_CONFIG,
	buildMemberRecordContainer,
	buildPunishmentDmContainer,
	buildPunishmentLogContainer,
	buildPunishmentResultContainer,
	buildScoreProgressBar,
	countActiveCases,
	extractMessageTextFromMessage,
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
	return {
		id: `case-${Math.random().toString(36).slice(2, 7)}`,
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
assert.ok(
	logText.includes(`https://discord.com/channels/1/9/10`),
	"log shows a jump link to the offending message",
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

console.log("punishment verification passed");
