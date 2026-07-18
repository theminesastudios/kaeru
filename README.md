# Kaeru Bot — Simple. Powerful. Time-Saving.

Kaeru is a streamlined Discord bot designed to cut down your server management time while boosting communication clarity and efficiency.  
Core features include ticketing, real-time translation, slang normalization, and AI-driven summarization and key point extraction.

## Cloudflare Workers AI setup

The `/translate` command lets users select a target language through Discord autocomplete. The message translation context command continues to translate into the invoking user's Discord language. Both commands detect the source language with `@cf/meta/llama-3.2-1b-instruct` and translate it with `@cf/meta/m2m100-1.2b`.

Ticket descriptions are summarized into concise thread titles with `@cf/meta/llama-3.2-1b-instruct`. The **Summary & Key Points** message command and `/timelapse` channel command use the same instruct model for localized summaries and structured key-point extraction. Ticket title generation keeps a deterministic local fallback if Workers AI is unavailable.

Required Vercel environment variables:

- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID shown on the Workers AI REST API page.
- `CLOUDFLARE_AI_TOKEN`: API token created from the Workers AI token template.

When creating a custom token rather than using Cloudflare's template, grant both `Workers AI - Read` and `Workers AI - Edit` permissions.

Translation is delivered directly to the deferred Discord interaction. Results longer than Discord's 2,000-character message limit are split into additional ephemeral follow-up messages, and mention parsing is disabled for translated output.

To inspect usage, open the Cloudflare dashboard, select the account used by `CLOUDFLARE_ACCOUNT_ID`, and open **Workers AI**. The usage view shows consumed neurons and model activity for the account. Cloudflare's free allocation resets daily.

No Poke workflow, callback route, public model hosting, or `POKE_INGEST_URL` is required.

## GitHub Org Metadata

Discord linked-role metadata includes:

- `is_miniapp`
- `github_org_member`

Required environment variables:

- `GITHUB_TOKEN`: GitHub token with permission to read organization memberships.
- `GITHUB_METADATA_ORG`: GitHub organization login to check. Defaults to `minesa-org`.

After changing linked-role metadata definitions, run `npm run build` so the app re-registers both commands and role metadata.
