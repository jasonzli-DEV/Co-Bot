import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import * as log from './logger.js';
import { MODELS } from './copilot.js';

const DISCORD_MSG_LIMIT = 2000;

function buildModelCommand() {
  const cmd = new SlashCommandBuilder()
    .setName('model')
    .setDescription('View or change the AI model Co-Bot uses');

  cmd.addStringOption(opt =>
    opt
      .setName('model')
      .setDescription('Model to switch to')
      .setRequired(true)
      .addChoices(...MODELS.map(m => ({ name: `${m.label} (${m.id})`, value: m.id })))
  );

  return cmd.toJSON();
}

export class DiscordBot {
  constructor(config, copilot) {
    this.config = config;
    this.copilot = copilot;
    this.client = null;
    this.channelQueues = new Map();
    this.processingChannels = new Set();
    this.shuttingDown = false;
  }

  // ─── Startup ────────────────────────────────────────────────────────────────

  async start() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.client.on('shardError', err => {
      if (String(err).includes('Used disallowed intents')) {
        log.error('Discord', 'Message Content Intent is not enabled.');
        log.error('Discord', 'Fix: https://discord.com/developers/applications → Bot → Privileged Gateway Intents → Message Content Intent');
        process.exit(1);
      }
    });

    this.client.once(Events.ClientReady, async () => {
      log.info('Discord', `Logged in as ${this.client.user.tag}`);
      log.info('Discord', `Invite URL: https://discord.com/api/oauth2/authorize?client_id=${this.client.user.id}&permissions=2048&scope=bot%20applications.commands`);
      await this.registerCommands();
    });

    this.client.on(Events.MessageCreate,     msg         => this.onMessage(msg));
    this.client.on(Events.InteractionCreate, interaction => this.onInteraction(interaction));

    await this.client.login(this.config.DISCORD_TOKEN);
  }

  async stop() {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    if (this.client) { try { await this.client.destroy(); } catch {} }
    log.info('Discord', 'Client destroyed');
  }

  // ─── Slash Commands ──────────────────────────────────────────────────────────

  async registerCommands() {
    const rest = new REST({ version: '10' }).setToken(this.config.DISCORD_TOKEN);
    try {
      await rest.put(
        Routes.applicationGuildCommands(this.client.user.id, this.config.DISCORD_GUILD_ID),
        { body: [buildModelCommand()] }
      );
      log.info('Discord', 'Slash commands registered');
    } catch (err) {
      log.warn('Discord', `Could not register slash commands: ${err.message}`);
    }
  }

  async onInteraction(interaction) {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'model') {
      const modelId = interaction.options.getString('model');
      const model   = MODELS.find(m => m.id === modelId);

      await interaction.deferReply();
      try {
        await this.copilot.setModel(modelId);
        await interaction.editReply(
          `Model switched to **${model.label}** (\`${model.id}\`)\n> ${model.description}`
        );
        log.info('Discord', `Model changed to ${modelId} by ${interaction.user.username}`);
      } catch (err) {
        log.error('Discord', `Model switch failed: ${err.message}`);
        await interaction.editReply(`Failed to switch model: ${err.message}`);
      }
    }
  }

  // ─── Message Handling ────────────────────────────────────────────────────────

  onMessage(message) {
    const { DISCORD_GUILD_ID, DISCORD_CHANNEL_ID, BLACKLISTED_CHANNELS, REPLY_TO_BOT } = this.config;

    if (message.guildId !== DISCORD_GUILD_ID) return;
    if (DISCORD_CHANNEL_ID && message.channelId !== DISCORD_CHANNEL_ID) return;
    if (BLACKLISTED_CHANNELS.includes(message.channelId)) return;
    if (!REPLY_TO_BOT && message.author.bot) return;
    if (!message.content && message.attachments.size === 0) return;

    if (!this.channelQueues.has(message.channelId)) {
      this.channelQueues.set(message.channelId, []);
    }
    this.channelQueues.get(message.channelId).push(message);
    this.processQueue(message.channelId);
  }

  async processQueue(channelId) {
    if (this.processingChannels.has(channelId)) return;
    this.processingChannels.add(channelId);

    const queue = this.channelQueues.get(channelId);
    while (queue && queue.length > 0) {
      const message = queue.shift();
      await this.processMessage(message).catch(err =>
        log.error('Bot', `Unhandled queue error: ${err.message}`)
      );
    }

    this.processingChannels.delete(channelId);
  }

  async processMessage(message) {
    // Show typing while we work
    let typingActive = true;
    message.channel.sendTyping().catch(() => {});
    const typingInterval = setInterval(() => {
      if (typingActive) message.channel.sendTyping().catch(() => {});
    }, 7000);

    try {
      const [prompt, attachments] = await Promise.all([
        this.buildPrompt(message),
        this.downloadAttachments(message),
      ]);

      log.debug('Bot', `→ Copilot (${prompt.length} chars, ${attachments.length} attachments) from ${message.author.username}`);

      const response = await this.copilot.send(prompt, attachments);

      typingActive = false;
      clearInterval(typingInterval);

      const content = response?.data?.content?.trim();
      if (!content) {
        await message.reply('Copilot returned an empty response.').catch(() => {});
        return;
      }

      await this.sendReply(message, content);
      log.info('Bot', `Replied (${content.length} chars) to ${message.author.username}`);
    } catch (err) {
      typingActive = false;
      clearInterval(typingInterval);
      log.error('Bot', `Error processing message: ${err.message}`, { stack: err.stack });
      await message.reply('Something went wrong communicating with Copilot. Please try again.').catch(() => {});
    }
  }

  // ─── Prompt Building ─────────────────────────────────────────────────────────

  async buildPrompt(message) {
    const count = this.config.CONTEXT_MESSAGE_COUNT;

    // No context – just the current message
    if (count === 1) return message.content;

    let history = [];

    if (count === 0) {
      // Fetch all messages (up to 1000)
      let lastId;
      while (history.length < 1000) {
        const opts = { limit: 100 };
        if (lastId) opts.before = lastId;
        const batch = Array.from((await message.channel.messages.fetch(opts)).values());
        history = history.concat(batch);
        if (batch.length < 100) break;
        lastId = batch[batch.length - 1].id;
      }
    } else {
      const batch = await message.channel.messages.fetch({ limit: count });
      history = Array.from(batch.values());
    }

    const context = history
      .filter(m => m.id !== message.id)
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map(m => `${m.author.username}: ${m.content}`)
      .join('\n');

    return context
      ? `${context}\n${message.author.username}: ${message.content}`
      : message.content;
  }

  // ─── Attachments ─────────────────────────────────────────────────────────────

  async downloadAttachments(message) {
    if (!this.config.IMAGE_SUPPORT || !message.attachments?.size) return [];

    const maxBytes = this.config.MAX_IMAGE_SIZE_MB * 1024 * 1024;
    const results = [];

    for (const [, attachment] of message.attachments) {
      if (!attachment.contentType?.startsWith('image/')) continue;

      if (attachment.size > maxBytes) {
        await message.reply(
          `"${attachment.name}" is too large (max ${this.config.MAX_IMAGE_SIZE_MB} MB).`
        ).catch(() => {});
        continue;
      }

      try {
        const tmpPath = path.join(os.tmpdir(), `cobot_${Date.now()}_${attachment.name}`);
        await this.downloadFile(attachment.url, tmpPath);
        results.push({ type: 'file', path: tmpPath, displayName: attachment.name });
        log.debug('Bot', `Downloaded attachment: ${attachment.name}`);
      } catch (err) {
        log.warn('Bot', `Failed to download attachment "${attachment.name}": ${err.message}`);
      }
    }

    return results;
  }

  downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https.get(url, res => {
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
      }).on('error', reject);
    });
  }

  // ─── Sending ─────────────────────────────────────────────────────────────────

  async sendReply(message, content) {
    const chunks = this.splitMessage(content);
    for (const chunk of chunks) {
      await message.reply(chunk);
    }
  }

  splitMessage(content) {
    if (content.length <= DISCORD_MSG_LIMIT) return [content];

    const chunks = [];
    let remaining = content;

    while (remaining.length > 0) {
      let chunk = remaining.slice(0, DISCORD_MSG_LIMIT);
      // Prefer a clean break at a newline or space
      const split = Math.max(chunk.lastIndexOf('\n'), chunk.lastIndexOf(' '));
      if (split > DISCORD_MSG_LIMIT - 500) chunk = chunk.slice(0, split);
      chunks.push(chunk);
      remaining = remaining.slice(chunk.length).trimStart();
    }

    return chunks;
  }
}
