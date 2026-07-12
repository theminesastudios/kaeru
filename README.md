# Kaeru Bot — Simple. Powerful. Time-Saving.

Kaeru is a streamlined Discord bot designed to cut down your server management time while boosting communication clarity and efficiency.  
Core features include ticketing, real-time translation, slang normalization, and AI-driven summarization and key point extraction.

## Poke translation setup

The `/translate` command and the message translation context command send the deferred Discord interaction directly to the configured Poke ingest endpoint. Poke receives the interaction token and application ID, then updates the original Discord response without Discord OAuth or a callback endpoint in Kaeru.

Both translation commands derive the target language from the invoking user's Discord client locale. The slash command does not expose a separate language option.

Required environment variable:

- `POKE_INGEST_URL`: Private HTTPS ingest URL supplied by the Poke workflow.

Kaeru sends this JSON payload:

```json
{
  "interaction_token": "DISCORD_INTERACTION_TOKEN",
  "application_id": "DISCORD_APPLICATION_ID",
  "original_text": "Text to translate",
  "target_language": "Language resolved from interaction.locale"
}
```

The first three fields match the Poke ingest contract. `target_language` tells the Poke workflow which language is configured in the invoking user's Discord client.

Treat `POKE_INGEST_URL` as a secret because possession of the URL may allow requests to the Poke workflow.

## GitHub Org Metadata

Discord linked-role metadata includes:

- `is_miniapp`
- `github_org_member`

Required environment variables:

- `GITHUB_TOKEN`: GitHub token with permission to read organization memberships.
- `GITHUB_METADATA_ORG`: GitHub organization login to check. Defaults to `minesa-org`.

After changing linked-role metadata definitions, run `npm run build` so the app re-registers both commands and role metadata.
