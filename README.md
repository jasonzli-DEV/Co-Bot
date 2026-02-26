# Co-Bot

A Discord bot powered by GitHub Copilot. Ask it questions, get AI responses — no setup beyond a Discord token and a GitHub account with Copilot.

## Features

- **GitHub device login** — on first run, the bot displays a one-time code. Visit GitHub, enter the code, and you're authenticated. The token is cached locally so you only do this once.
- **`/model` command** — switch the AI model at any time from inside Discord:
  - **ChatGPT 5** (`gpt-4.5`)
  - **ChatGPT 4.1** (`gpt-4.1`) ← default
  - **ChatGPT 4o** (`gpt-4o`)
- **Message context** — configurable number of recent messages sent as context.
- **Image support** — attach images in Discord and they're forwarded to the AI.
- **Per-channel queuing** — messages are processed in order; no race conditions.
- **Graceful shutdown** — Ctrl-C cleans up cleanly.

## Requirements

- Node.js ≥ 18
- A Discord bot token with **Message Content Intent** enabled
- A GitHub account with an active **Copilot** subscription

## Setup

```bash
git clone https://github.com/jasonzli-DEV/Co-Bot
cd Co-Bot
npm install
cp .env.example .env
# Edit .env — fill in DISCORD_TOKEN and DISCORD_GUILD_ID at minimum
npm start
```

On first start you will see:

```
┌────────────────────────────────────────────────┐
│        GitHub Authentication Required          │
├────────────────────────────────────────────────┤
│  Visit:     https://github.com/login/device   │
│  Enter code: XXXX-XXXX                        │
└────────────────────────────────────────────────┘
```

Visit the URL, enter the code, and the bot will continue automatically. The token is saved in `.cobot-auth.json` so you never need to do this again.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DISCORD_TOKEN` | ✓ | — | Your Discord bot token |
| `DISCORD_GUILD_ID` | ✓ | — | Server ID for the bot |
| `DISCORD_CHANNEL_ID` | | — | Restrict to one channel (optional) |
| `BLACKLISTED_CHANNEL_IDS` | | — | Comma-separated channel IDs to ignore |
| `COPILOT_GITHUB_TOKEN` | | — | Skip device flow with an existing token |
| `REPLY_TO_BOT` | | `false` | Whether to reply to other bots |
| `CONTEXT_MESSAGE_COUNT` | | `5` | Past messages to include as context (`0` = unlimited) |
| `IMAGE_SUPPORT` | | `true` | Forward image attachments to the AI |
| `MAX_IMAGE_SIZE_MB` | | `5` | Maximum image size |
| `LOG_LEVEL` | | `INFO` | `ERROR` / `WARN` / `INFO` / `DEBUG` |

## Discord Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application → Bot
3. Enable **Message Content Intent** under *Privileged Gateway Intents*
4. Copy the bot token into `.env` as `DISCORD_TOKEN`
5. Invite the bot with `bot` and `applications.commands` scopes

## Commands

| Command | Description |
|---|---|
| `/model <model>` | Switch the AI model |

## Testing

```bash
npm test
```

If no token is stored yet, the auth/utility tests still run. Live API tests are skipped until you've completed device login.

## File Structure

```
src/
  index.js    Entry point — wires everything together
  auth.js     GitHub device flow authentication
  copilot.js  Copilot SDK wrapper + model management
  bot.js      Discord client, slash commands, message handling
  logger.js   Structured logging
test/
  test.js     Test suite (auth, utilities, live API)
```
