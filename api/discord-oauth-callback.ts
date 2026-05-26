import { connectedOAuthPage, discordOAuthCallback, failedOAuthPage } from "./oauth.js";
import { updateDiscordMetadata } from "../src/utils/database.js";
import { fetchDiscord } from "../src/utils/discord.js";

const failedPage = failedOAuthPage("public/pages/failed.html");

export default discordOAuthCallback({
	templates: {
		success: connectedOAuthPage("public/pages/connected.html"),
		missingCode: failedPage,
		oauthError: failedPage,
		invalidState: failedPage,
		serverError: failedPage,
	},
	async onAuthorize({ user, tokens }: { user: any; tokens: any }) {
		const { getDatabase } = await import("../src/utils/database.js");
		const database = getDatabase();

		await database.set(user.id, {
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			expiresAt: tokens.expires_at,
			scope: tokens.scope,
		});

		await updateDiscordMetadata(user.id, tokens.access_token);

		try {
			const dmChannel = await fetchDiscord(
				"/users/@me/channels",
				process.env.DISCORD_BOT_TOKEN!,
				true,
				"POST",
				{ recipient_id: user.id },
			);

			if (dmChannel?.id) {
				await fetchDiscord(
					`/channels/${dmChannel.id}/messages`,
					process.env.DISCORD_BOT_TOKEN!,
					true,
					"POST",
					{
						components: [
							{
								type: 17,
								accent_color: null,
								spoiler: false,
								components: [
									{
										type: 10,
										content:
											"## Authorize complete\nYou can now open a support ticket with </create:1477209072800632845>.\n\nAfter your ticket is created, you can continue the conversation from DMs with </send:1477601535692247294>.",
									},
									{
										type: 10,
										content: "-# Sent automatically after app authorization.",
									},
								],
							},
						],
						flags: 32768,
					},
				);
			}
		} catch (dmError) {
			console.error("Failed to send post-authorize DM:", dmError);
		}
	},
});
