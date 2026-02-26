import { CopilotClient } from '@github/copilot-sdk';
import * as log from './logger.js';

// Models available via the /model command
export const MODELS = [
  { id: 'gpt-4.5',  label: 'ChatGPT 5',  description: 'Most powerful model (gpt-4.5)' },
  { id: 'gpt-4.1',  label: 'ChatGPT 4.1', description: 'Fast and capable (gpt-4.1)' },
  { id: 'gpt-4o',   label: 'ChatGPT 4o',  description: 'Default balanced model (gpt-4o)' },
];

export const DEFAULT_MODEL = 'gpt-4.1';

export class CopilotManager {
  constructor(token) {
    this.token = token;
    this.client = null;
    this.session = null;
    this.model = DEFAULT_MODEL;
  }

  async start() {
    log.info('Copilot', 'Starting Copilot SDK...');

    this.client = new CopilotClient({ githubToken: this.token });
    await this.client.start();
    log.info('Copilot', 'SDK started');

    await this._createSession();
  }

  async setModel(modelId) {
    const valid = MODELS.find(m => m.id === modelId);
    if (!valid) throw new Error(`Unknown model "${modelId}"`);

    this.model = modelId;
    await this._createSession();
    log.info('Copilot', `Model set to ${modelId}`);
  }

  async send(prompt, attachments = []) {
    const opts = { prompt };
    if (attachments.length > 0) opts.attachments = attachments;
    return this.session.sendAndWait(opts);
  }

  async stop() {
    if (this.session) { try { await this.session.destroy(); } catch {} }
    if (this.client)  { try { await this.client.stop();    } catch {} }
  }

  async _createSession() {
    if (this.session) { try { await this.session.destroy(); } catch {} }
    this.session = await this.client.createSession({ model: this.model });
    log.info('Copilot', `Session ready (model: ${this.model})`);
  }
}
