import "dotenv/config";
import { RoleConnectionMetadataTypes, type RoleConnectionMetadataInput } from "@minesa-org/mini-interaction";

const ROLE_CONNECTION_METADATA: RoleConnectionMetadataInput[] = [
	{
		key: "github_org_member",
		name: "GitHub Org Member",
		description: "User is a member of the configured GitHub organization.",
		type: RoleConnectionMetadataTypes.IntegerGreaterThanOrEqual,
		name_localizations: {
			tr: "GitHub Organizasyon Uyesi",
		},
		description_localizations: {
			tr: "Kullanici ayarlanan GitHub organizasyonunun bir uyesidir.",
		},
	},
];

const applicationId = process.env.DISCORD_APPLICATION_ID ?? process.env.DISCORD_APP_ID;
const botToken = process.env.DISCORD_BOT_TOKEN ?? process.env.DISCORD_TOKEN;

if (!applicationId || !botToken) {
	console.log(
		"Discord application id or bot token not found. Set DISCORD_APPLICATION_ID/DISCORD_APP_ID and DISCORD_BOT_TOKEN/DISCORD_TOKEN. Skipping command registration.",
	);
	process.exit(0);
}

const { mini } = await import("../api/interactions");

await mini.registerCommands(botToken);
await mini.registerMetadata(botToken, ROLE_CONNECTION_METADATA);

console.log("Registration complete!");
