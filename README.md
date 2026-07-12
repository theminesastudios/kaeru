# Kaeru Bot — Simple. Powerful. Time-Saving.

Kaeru is a streamlined Discord bot designed to cut down your server management time while boosting communication clarity and efficiency.  
Core features include ticketing, real-time translation, slang normalization, and AI-driven summarization and key point extraction.

## Poke translation setup

The `/translate` command and the message translation context command defer an ephemeral Discord response, then send the interaction to the configured Poke ingest endpoint. Both commands derive the target language from the invoking user's Discord client locale.

Required environment variable:

- `POKE_INGEST_URL`: Private HTTPS ingest URL supplied by the Poke workflow.

Kaeru sends this JSON payload to Poke:

```json
{
  "interaction_token": "DISCORD_INTERACTION_TOKEN",
  "interaction_token_b64": "BASE64URL_ENCODED_DISCORD_INTERACTION_TOKEN",
  "application_id": "DISCORD_APPLICATION_ID",
  "original_text": "Text to translate",
  "target_language": "Language resolved from interaction.locale"
}
```

`interaction_token_b64` is an opaque transport-safe backup. Poke should forward every input field unchanged and append only `translated_text`. This prevents the LLM or forwarding step from accidentally reformatting the Discord interaction token.

After translating, Poke must send a `POST` request with `Content-Type: application/json` to:

```text
https://YOUR_KAERU_DOMAIN/api/poke-webhook
```

Callback payload:

```json
{
  "interaction_token": "DISCORD_INTERACTION_TOKEN",
  "interaction_token_b64": "BASE64URL_ENCODED_DISCORD_INTERACTION_TOKEN",
  "application_id": "DISCORD_APPLICATION_ID",
  "original_text": "Text to translate",
  "target_language": "turkish",
  "translated_text": "Translated result"
}
```

The callback route prefers the decoded Base64URL token, falls back to the trimmed plain token for older callbacks, patches the original deferred Discord interaction response, disables mention parsing, and sends additional ephemeral follow-up messages when the translation exceeds Discord's 2,000-character content limit.

Treat `POKE_INGEST_URL` and Discord interaction tokens as secrets. The callback currently follows Poke's unauthenticated contract and therefore does not expect an authorization header.

## GitHub Org Metadata

Discord linked-role metadata includes:

- `is_miniapp`
- `github_org_member`

Required environment variables:

- `GITHUB_TOKEN`: GitHub token with permission to read organization memberships.
- `GITHUB_METADATA_ORG`: GitHub organization login to check. Defaults to `minesa-org`.

After changing linked-role metadata definitions, run `npm run build` so the app re-registers both commands and role metadata.
