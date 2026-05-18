import { cleanupCustomVoiceChannels } from "../src/utils/customVoice.ts";

export default async function handler(req: any, res: any) {
	if (req.method && req.method !== "GET" && req.method !== "POST") {
		res.setHeader?.("Allow", "GET, POST");
		return res.status(405).json({ error: "Method not allowed" });
	}

	const cronSecret = process.env.CRON_SECRET?.trim();
	if (cronSecret) {
		const authorization = typeof req.headers?.authorization === "string"
			? req.headers.authorization
			: "";

		if (authorization !== `Bearer ${cronSecret}`) {
			return res.status(401).json({ error: "Unauthorized" });
		}
	}

	try {
		const result = await cleanupCustomVoiceChannels();
		return res.status(200).json({
			ok: true,
			...result,
		});
	} catch (error) {
		console.error("[Kaeru] voice cleanup failed:", error);
		return res.status(500).json({
			ok: false,
			error: error instanceof Error ? error.message : "Unknown error",
		});
	}
}
