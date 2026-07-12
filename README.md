# Kaeru Bot — Simple. Powerful. Time-Saving.

Kaeru is a streamlined Discord bot designed to cut down your server management time while boosting communication clarity and efficiency.  
Core features include ticketing, real-time translation, slang normalization, and AI-driven summarization and key point extraction.

## Poke translation setup

The `/translate` command and the message translation context command send translation jobs to the Poke V2 API. Poke must have an outbound HTTP integration or recipe that can perform the callback POST requested in each job.

Required environment variables:

- `POKE_API_KEY`: V2 API key created in Poke Kitchen. Legacy `pk_` keys do not work with the new API endpoint.
- `POKE_CALLBACK_SECRET`: Random secret of at least 32 characters used to encrypt the temporary Discord callback state.
- `POKE_CALLBACK_URL`: Public HTTPS URL for the callback endpoint, such as `https://your-domain.example/api/poke-webhook`. This is optional on Vercel when `VERCEL_PROJECT_PRODUCTION_URL` or `VERCEL_URL` is available.

The callback state expires after 14 minutes. No Discord interaction token is stored in a database or exposed to Poke as plaintext.

## GitHub Org Metadata

Discord linked-role metadata includes:

- `is_miniapp`
- `github_org_member`

Required environment variables:

- `GITHUB_TOKEN`: GitHub token with permission to read organization memberships.
- `GITHUB_METADATA_ORG`: GitHub organization login to check. Defaults to `minesa-org`.

After changing linked-role metadata definitions, run `npm run build` so the app re-registers both commands and role metadata.
