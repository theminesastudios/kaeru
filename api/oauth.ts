import { MiniInteraction } from "@minesa-org/mini-interaction";

type VerificationOptions = Parameters<MiniInteraction["discordOAuthVerificationPage"]>[0];
type CallbackOptions = Parameters<MiniInteraction["discordOAuthCallback"]>[0];
type OAuthTemplate = ReturnType<MiniInteraction["connectedOAuthPage"]>;

function createOAuthMini() {
	return new MiniInteraction({
		debug: true,
	});
}

export function discordOAuthVerificationPage(
	options: VerificationOptions,
): ReturnType<MiniInteraction["discordOAuthVerificationPage"]> {
	return async (req, res) => createOAuthMini().discordOAuthVerificationPage(options)(req, res);
}

export function discordOAuthCallback(
	options: CallbackOptions,
): ReturnType<MiniInteraction["discordOAuthCallback"]> {
	return async (req, res) => createOAuthMini().discordOAuthCallback(options)(req, res);
}

export function connectedOAuthPage(htmlFile: string): OAuthTemplate {
	return { htmlFile };
}

export function failedOAuthPage(htmlFile: string): OAuthTemplate {
	return { htmlFile };
}
