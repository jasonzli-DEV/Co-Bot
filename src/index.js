import dotenv from 'dotenv';
import * as log from './logger.js';
import { ensureAuthenticated, clearToken } from './auth.js';
import { CopilotManager } from './copilot.js';
import { DiscordBot } from './bot.js';

dotenv.config();

// ─── Config ──────────────────────────────────────────────────────────────────

function loadConfig() {
  const required = ['DISCORD_TOKEN', 'DISCORD_GUILD_ID'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    missing.forEach(k => log.error('Config', `Missing required variable: ${k}`));
    process.exit(1);
  }

  const int = (key, fallback) => {
    const n = parseInt(process.env[key] || String(fallback), 10);
    return isNaN(n) ? fallback : n;
  };

  return {
    DISCORD_TOKEN:       process.env.DISCORD_TOKEN,
    DISCORD_GUILD_ID:    process.env.DISCORD_GUILD_ID,
    DISCORD_CHANNEL_ID:  process.env.DISCORD_CHANNEL_ID  || null,
    BLACKLISTED_CHANNELS: (process.env.BLACKLISTED_CHANNEL_IDS || '')
      .split(',').map(s => s.trim()).filter(Boolean),
    REPLY_TO_BOT:         process.env.REPLY_TO_BOT === 'true',
    CONTEXT_MESSAGE_COUNT: int('CONTEXT_MESSAGE_COUNT', 5),
    IMAGE_SUPPORT:        process.env.IMAGE_SUPPORT !== 'false',
    MAX_IMAGE_SIZE_MB:    int('MAX_IMAGE_SIZE_MB', 5),
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔═══════════════════════╗');
  console.log('║       Co-Bot          ║');
  console.log('╚═══════════════════════╝\n');

  const config = loadConfig();
  log.info('Config', 'Configuration loaded');

  // 1. Authenticate with GitHub (device flow if no token stored)
  log.info('Auth', 'Checking GitHub authentication...');
  let token;
  try {
    token = await ensureAuthenticated();
    log.info('Auth', 'Authenticated successfully');
  } catch (err) {
    log.error('Auth', `Authentication failed: ${err.message}`);
    process.exit(1);
  }

  // 2. Start Copilot
  const copilot = new CopilotManager(token);
  try {
    await copilot.start();
  } catch (err) {
    log.error('Copilot', `Startup failed: ${err.message}`);
    log.error('Copilot', 'Make sure your GitHub account has an active Copilot subscription.');
    process.exit(1);
  }

  // 3. Start Discord bot
  const bot = new DiscordBot(config, copilot);
  try {
    await bot.start();
  } catch (err) {
    log.error('Discord', `Startup failed: ${err.message}`);
    process.exit(1);
  }

  // ─── Graceful Shutdown ───────────────────────────────────────────────────────
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('Shutdown', `Signal: ${signal}`);
    await bot.stop();
    await copilot.stop();
    setTimeout(() => process.exit(0), 300);
  }

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', err => {
    if (err?.code === 'ERR_STREAM_DESTROYED') return; // harmless on shutdown
    log.error('Process', 'Uncaught exception', { error: err.message, stack: err.stack });
    shutdown('uncaughtException');
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
