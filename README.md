# Kaeru Bot — Simple. Powerful. Time-Saving.

Kaeru is a streamlined Discord bot designed to cut down your server management time while boosting communication clarity and efficiency.  
Core features include ticketing, real-time translation, slang normalization, and AI-driven summarization and key point extraction.

## Cloudflare Workers AI translation setup

The `/translate` command and the message translation context command defer an ephemeral Discord response, detect the source language with `@cf/meta/llama-3.2-1b-instruct`, and translate it into the invoking user's Discord language with `@cf/meta/m2m100-1.2b`.

Required Vercel environment variables:

- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID shown on the Workers AI REST API page.
- `CLOUDFLARE_AI_TOKEN`: API token created from the Workers AI token template.

When creating a custom token rather than using Cloudflare's template, grant both `Workers AI - Read` and `Workers AI - Edit` permissions.

Translation is delivered directly to the deferred Discord interaction. Results longer than Discord's 2,000-character message limit are split into additional ephemeral follow-up messages, and mention parsing is disabled for translated output.

No Poke workflow, callback route, public model hosting, or `POKE_INGEST_URL` is required.

## GitHub Org Metadata

Discord linked-role metadata includes:

- `is_miniapp`
- `github_org_member`

Required environment variables:

- `GITHUB_TOKEN`: GitHub token with permission to read organization memberships.
- `GITHUB_METADATA_ORG`: GitHub organization login to check. Defaults to `minesa-org`.

After changing linked-role metadata definitions, run `npm run build` so the app re-registers both commands and role metadata.
