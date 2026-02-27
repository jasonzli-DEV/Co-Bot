import * as log from './logger.js';

const COPILOT_API = 'https://api.githubcopilot.com/chat/completions';

// Models available via the /model command
export const MODELS = [
  { id: 'gpt-5-mini', label: 'ChatGPT 5 mini',  description: 'Latest mini model (gpt-5-mini)' },
  { id: 'gpt-4.1',   label: 'ChatGPT 4.1',     description: 'Fast and capable (gpt-4.1)' },
  { id: 'gpt-4o',    label: 'ChatGPT 4o',      description: 'Balanced general model (gpt-4o)' },
];

export const DEFAULT_MODEL = 'gpt-4.1';

export class CopilotManager {
  constructor(token) {
    this.token = token;
    this.model = DEFAULT_MODEL;
  }

  async start() {
    log.info('Copilot', 'Starting Copilot client...');
    if (!this.token) throw new Error('No GitHub token provided');
    log.info('Copilot', `Copilot ready (model: ${this.model})`);
  }

  async setModel(modelId) {
    const valid = MODELS.find(m => m.id === modelId);
    if (!valid) throw new Error(`Unknown model "${modelId}"`);
    this.model = modelId;
    log.info('Copilot', `Model set to ${modelId}`);
  }

  async send(prompt, attachments = []) {
    let content;
    if (attachments.length > 0) {
      content = [
        { type: 'text', text: prompt },
        ...attachments.map(a => ({
          type: 'image_url',
          image_url: { url: `data:${a.contentType};base64,${a.data.toString('base64')}` },
        })),
      ];
    } else {
      content = prompt;
    }

    const result = await this._call([{ role: 'user', content }]);
    // Return in the same shape as the old SDK so bot.js needs no changes
    return { data: { content: result } };
  }

  async stop() {
    // Nothing to tear down — direct HTTP calls are stateless
  }

  async _call(messages) {
    const res = await fetch(COPILOT_API, {
      method: 'POST',
      headers: {
        Authorization:   `Bearer ${this.token}`,
        'Content-Type':  'application/json',
        'User-Agent':    'co-bot/1.0',
        'x-initiator':   'user',
        'Openai-Intent': 'conversation-edits',
      },
      body: JSON.stringify({ model: this.model, messages }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Copilot API ${res.status}: ${body}`);
    }

    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? '';
  }
}
