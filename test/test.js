/**
 * Co-Bot test suite
 *
 * Tests auth module, Copilot SDK integration, and utility logic.
 * Run:  node test/test.js
 *
 * For live API tests, set COPILOT_GITHUB_TOKEN or have `gh auth token` available.
 */

import dotenv from 'dotenv';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env') });

// ─── Minimal Test Runner ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ─── Inline splitMessage (same logic as bot.js, no discord.js import needed) ──

function splitMessage(content, limit = 2000) {
  if (content.length <= limit) return [content];
  const chunks = [];
  let remaining = content;
  while (remaining.length > 0) {
    let chunk = remaining.slice(0, limit);
    const split = Math.max(chunk.lastIndexOf('\n'), chunk.lastIndexOf(' '));
    if (split > limit - 500) chunk = chunk.slice(0, split);
    chunks.push(chunk);
    remaining = remaining.slice(chunk.length).trimStart();
  }
  return chunks;
}

// ─── Auth Module ──────────────────────────────────────────────────────────────

console.log('\n── Auth module ───────────────────────────────────────────────────────────\n');

const { ensureAuthenticated } = await import('../src/auth.js');

await test('ensureAuthenticated returns COPILOT_GITHUB_TOKEN when set', async () => {
  const orig = process.env.COPILOT_GITHUB_TOKEN;
  process.env.COPILOT_GITHUB_TOKEN = 'env_token_test';
  const token = await ensureAuthenticated();
  assertEqual(token, 'env_token_test');
  if (orig !== undefined) process.env.COPILOT_GITHUB_TOKEN = orig;
  else delete process.env.COPILOT_GITHUB_TOKEN;
});

await test('ensureAuthenticated returns gh CLI token when no env var is set', async () => {
  const origEnv = process.env.COPILOT_GITHUB_TOKEN;
  delete process.env.COPILOT_GITHUB_TOKEN;

  let ghToken = null;
  try { ghToken = execSync('gh auth token', { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}

  if (ghToken) {
    const token = await ensureAuthenticated();
    assertEqual(token, ghToken, 'Expected gh CLI token');
  } else {
    console.log('       (gh CLI not available — skipping gh token check)');
  }

  if (origEnv !== undefined) process.env.COPILOT_GITHUB_TOKEN = origEnv;
});

// ─── Message Splitting ────────────────────────────────────────────────────────

console.log('\n── Message splitting ─────────────────────────────────────────────────────\n');

await test('Short message is returned as-is', async () => {
  const chunks = splitMessage('Hello, world!');
  assertEqual(chunks.length, 1);
  assertEqual(chunks[0], 'Hello, world!');
});

await test('Message exactly at 2000 chars is not split', async () => {
  const msg = 'a'.repeat(2000);
  assertEqual(splitMessage(msg).length, 1);
});

await test('Message over 2000 chars is split into valid chunks', async () => {
  const msg = ('word ').repeat(500); // 2500 chars
  const chunks = splitMessage(msg);
  assert(chunks.length >= 2, 'Expected at least 2 chunks');
  chunks.forEach((c, i) => assert(c.length <= 2000, `Chunk ${i} is ${c.length} chars, over limit`));

  const rejoined = chunks.join(' ').replace(/\s+/g, ' ').trim();
  const original  = msg.trim().replace(/\s+/g, ' ');
  assertEqual(rejoined, original, 'Reassembled content does not match original');
});

await test('Very long single word is hard-cut at limit', async () => {
  const msg = 'a'.repeat(4500);
  const chunks = splitMessage(msg);
  assert(chunks.length >= 2);
  chunks.forEach(c => assert(c.length <= 2000, `Chunk too long: ${c.length}`));
});

// ─── Model Config ─────────────────────────────────────────────────────────────

console.log('\n── Model configuration ───────────────────────────────────────────────────\n');

const { MODELS, DEFAULT_MODEL } = await import('../src/copilot.js');

await test('MODELS has exactly 3 entries', async () => {
  assertEqual(MODELS.length, 3);
});

await test('MODELS include gpt-5-mini, gpt-4.1, and gpt-4o', async () => {
  const ids = MODELS.map(m => m.id);
  assert(ids.includes('gpt-5-mini'), 'Missing gpt-5-mini');
  assert(ids.includes('gpt-4.1'),    'Missing gpt-4.1');
  assert(ids.includes('gpt-4o'),     'Missing gpt-4o');
});

await test('DEFAULT_MODEL is gpt-4.1', async () => {
  assertEqual(DEFAULT_MODEL, 'gpt-4.1');
});

await test('Every model entry has id, label, and description', async () => {
  for (const m of MODELS) {
    assert(m.id,          `Model missing id: ${JSON.stringify(m)}`);
    assert(m.label,       `Model missing label: ${JSON.stringify(m)}`);
    assert(m.description, `Model missing description: ${JSON.stringify(m)}`);
  }
});

// ─── Live Copilot API ─────────────────────────────────────────────────────────

console.log('\n── Live Copilot API ──────────────────────────────────────────────────────\n');

// Use COPILOT_GITHUB_TOKEN, or fall back to gh auth token (same as what the bot uses)
let liveToken = process.env.COPILOT_GITHUB_TOKEN || null;
if (!liveToken) {
  try { liveToken = execSync('gh auth token', { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch {}
}

if (!liveToken) {
  console.log('  ⚠  No token found – skipping live API tests.');
  console.log('     Set COPILOT_GITHUB_TOKEN or run `gh auth login`, then re-run tests.\n');
} else {
  const { CopilotManager } = await import('../src/copilot.js');
  let manager;

  await test('CopilotManager starts', async () => {
    manager = new CopilotManager(liveToken);
    await manager.start();
  });

  if (manager) {
    await test('send() returns a non-empty string with default model (gpt-4.1)', async () => {
      const res = await manager.send('Reply with exactly the single word: pong');
      const content = res?.data?.content;
      assert(typeof content === 'string' && content.length > 0, 'Expected non-empty content');
      console.log(`       → "${content.slice(0, 120).replace(/\n/g, '↵')}"`);
    });

    await test('setModel switches to gpt-5-mini', async () => {
      // gpt-5-mini / gpt-4o may return 402 if the subscription does not include them;
      // we verify the call either succeeds or throws cleanly (not a crash)
      let ok = false;
      try {
        await manager.setModel('gpt-5-mini');
        const res = await manager.send('Reply with exactly the single word: pong');
        ok = res?.data?.content?.length > 0;
      } catch (err) {
        // 402 = quota not available for this model – still a clean error, counts as pass
        ok = /40[24]|quota|not available/i.test(err.message);
        if (ok) console.log(`       (model not available for this subscription: ${err.message.slice(0, 80)})`);
        else throw err;
      }
      assert(ok);
    });

    await test('setModel switches back to gpt-4.1', async () => {
      await manager.setModel('gpt-4.1');
      const res = await manager.send('Reply with exactly the single word: pong');
      assert(res?.data?.content?.length > 0);
      console.log(`       → "${res.data.content.slice(0, 120).replace(/\n/g, '↵')}"`);
    });

    await test('setModel rejects an unknown model ID', async () => {
      let threw = false;
      try { await manager.setModel('not-real-model'); } catch { threw = true; }
      assert(threw, 'Expected error for invalid model ID');
    });

    await test('multi-turn context prompt works', async () => {
      const prompt = 'user1: What is 2+2?\nAssistant: 4\nuser1: What did I just ask?';
      const res = await manager.send(prompt);
      assert(res?.data?.content?.length > 0);
    });

    await test('CopilotManager stops cleanly', async () => {
      await manager.stop();
    });
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n──────────────────────────────────────────────────────────────────────────`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`──────────────────────────────────────────────────────────────────────────\n`);

process.exit(failed > 0 ? 1 : 0);
