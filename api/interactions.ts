import {
	AutocompleteContext,
	MiniInteraction,
	verifyAndParseInteraction,
} from "@minesa-org/mini-interaction";
import {
	InteractionType,
	type APIApplicationCommandAutocompleteInteraction,
} from "discord-api-types/v10";
import { getTranslationLanguageChoices } from "../src/utils/translationLanguages.js";
import { getCreateServerAutocompleteChoices } from "../src/utils/createTicketFlow.js";
import { getActiveTicketAutocompleteChoices } from "../src/utils/ticketControls.js";
import { getPunishmentAutocompleteChoices } from "../src/commands/punishment.js";

type HeaderMap =
	| Record<string, string | string[] | undefined>
	| {
			get(name: string): string | null;
	  };

type NodeRequest = {
	body?: unknown;
	rawBody?: string | Uint8Array | Buffer;
	headers: HeaderMap;
	method?: string;
	url?: string;
	[Symbol.asyncIterator]?: () => AsyncIterableIterator<Uint8Array>;
};

type NodeResponse = {
	statusCode?: number;
	setHeader?: (name: string, value: string) => void;
	end: (body?: string) => void;
	status?: (code: number) => NodeResponse;
	json?: (body: unknown) => void;
};

export const config = {
	api: {
		bodyParser: false,
	},
};

export const mini = new MiniInteraction({
	commandsDirectory: "src/commands",
	componentsDirectory: "src/components",
	utilsDirectory: "src/utils",
	timeoutConfig: {
		initialResponseTimeout: 30000,
		autoDeferSlowOperations: true,
		enableTimeoutWarnings: true,
		enableResponseDebugLogging: true,
	},
	debug: true,
});

const nodeHandler = mini.createNodeHandler();

export default async function handler(req: NodeRequest, res: NodeResponse) {
	const body = await readRawBody(req);
	req.rawBody = body;

	const signature = getHeader(req.headers, "x-signature-ed25519");
	const timestamp = getHeader(req.headers, "x-signature-timestamp");
	const publicKey = process.env.DISCORD_PUBLIC_KEY;

	if (!publicKey) {
		sendJson(res, 500, { error: "[MiniInteraction] Missing DISCORD_PUBLIC_KEY." });
		return;
	}

	if (!signature || !timestamp) {
		sendText(res, 401, "missing Discord signature headers");
		return;
	}

	try {
		const interaction = await verifyAndParseInteraction({
			body,
			signature,
			timestamp,
			publicKey,
		});

		if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
			sendJson(res, 200, await handleAutocomplete(interaction));
			return;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : "";
		if (message.includes("invalid interaction signature")) {
			sendText(res, 401, "invalid request signature");
			return;
		}

		throw error;
	}

	return nodeHandler(req, res);
}

const TRANSLATE_COMMANDS = new Set(["çevir", "translate"]);
const TRANSLATE_LANGUAGE_OPTIONS = new Set(["dil", "language"]);
const PUNISHMENT_AUTOCOMPLETE_OPTIONS = new Set(["reason", "case"]);

/**
 * `/punishment forgive` autocompletes the *target's* cases, not the moderator's,
 * so the user option typed in the same interaction has to be read back out.
 */
async function resolveForgiveTarget(
	interaction: APIApplicationCommandAutocompleteInteraction,
): Promise<string> {
	const options = interaction.data.options ?? [];
	for (const option of options) {
		if (option.type === 2 /* User */ && "value" in option) {
			return String(option.value);
		}
	}

	return interaction.user?.id ?? "";
}

async function handleAutocomplete(
	interaction: APIApplicationCommandAutocompleteInteraction,
) {
	const autocomplete = new AutocompleteContext(interaction);
	const focusedOption = autocomplete.getFocusedOption(false);

	if (TRANSLATE_COMMANDS.has(interaction.data.name)) {
		if (!focusedOption || !TRANSLATE_LANGUAGE_OPTIONS.has(focusedOption.name)) {
			return autocomplete.respond([]);
		}

		return autocomplete.respond(
			getTranslationLanguageChoices(focusedOption.value, 25, interaction.locale),
		);
	}

	const user = interaction.user ?? interaction.member?.user;

	if (!focusedOption || !user) {
		return autocomplete.respond([]);
	}

	if (interaction.data.name === "create" && focusedOption.name === "server") {
		return autocomplete.respond(
			await getCreateServerAutocompleteChoices(user.id, focusedOption.value),
		);
	}

	if (interaction.data.name === "switch-ticket" && focusedOption.name === "ticket") {
		return autocomplete.respond(
			await getActiveTicketAutocompleteChoices(user.id, focusedOption.value),
		);
	}

	// `/punishment` shares two autocomplete sources: prepared reasons for the
	// `member` subcommand and the member's own cases for `forgive`.
	if (interaction.data.name === "punishment") {
		if (!PUNISHMENT_AUTOCOMPLETE_OPTIONS.has(focusedOption.name)) {
			return autocomplete.respond([]);
		}

		const guildId = interaction.guild_id ?? null;
		let ownerId = user.id;

		if (focusedOption.name === "case" && focusedOption.subcommand === "forgive") {
			ownerId = await resolveForgiveTarget(interaction);
		}

		return autocomplete.respond(
			await getPunishmentAutocompleteChoices({
				guildId,
				userId: ownerId,
				optionName: focusedOption.name,
				query: focusedOption.value,
			}),
		);
	}

	return autocomplete.respond([]);
}

async function readRawBody(req: NodeRequest) {
	if (typeof req.rawBody === "string") {
		return req.rawBody;
	}

	if (req.rawBody instanceof Uint8Array) {
		return Buffer.from(req.rawBody).toString("utf8");
	}

	if (typeof req.body === "string") {
		return req.body;
	}

	if (req.body && typeof req.body === "object") {
		return JSON.stringify(req.body);
	}

	if (typeof req[Symbol.asyncIterator] === "function") {
		const chunks: Buffer[] = [];
		for await (const chunk of req as AsyncIterable<Uint8Array>) {
			chunks.push(Buffer.from(chunk));
		}

		return Buffer.concat(chunks).toString("utf8");
	}

	return "";
}

function getHeader(headers: HeaderMap, name: string) {
	if ("get" in headers && typeof headers.get === "function") {
		return headers.get(name) ?? undefined;
	}

	const recordHeaders = headers as Record<string, string | string[] | undefined>;
	const direct =
		recordHeaders[name] ?? recordHeaders[name.toLowerCase()] ?? recordHeaders[name.toUpperCase()];
	return Array.isArray(direct) ? direct[0] : direct;
}

function sendJson(res: NodeResponse, statusCode: number, body: unknown) {
	if (typeof res.status === "function" && typeof res.json === "function") {
		res.status(statusCode).json?.(body);
		return;
	}

	res.statusCode = statusCode;
	res.setHeader?.("Content-Type", "application/json; charset=utf-8");
	res.end(JSON.stringify(body));
}

function sendText(res: NodeResponse, statusCode: number, body: string) {
	res.status?.(statusCode);
	res.statusCode = statusCode;
	res.setHeader?.("Content-Type", "text/plain; charset=utf-8");
	res.end(body);
}
