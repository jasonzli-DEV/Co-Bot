import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// GitHub OAuth App client_id used for Copilot device flow authentication.
// This is the same client_id used by the official GitHub Copilot Neovim plugin,
// which is widely compatible with Copilot's token exchange.
const CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const SCOPE = 'read:user';

const AUTH_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.cobot-auth.json'
);

export function loadStoredToken() {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      const { token } = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
      return token || null;
    }
  } catch {}
  return null;
}

export function saveToken(token) {
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ token }, null, 2));
}

export function clearToken() {
  try { fs.unlinkSync(AUTH_FILE); } catch {}
}

async function githubPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function deviceLogin() {
  // Step 1 – request a device code
  const { device_code, user_code, verification_uri, expires_in, interval } =
    await githubPost('https://github.com/login/device/code', {
      client_id: CLIENT_ID,
      scope: SCOPE,
    });

  if (!device_code) throw new Error('Failed to obtain device code from GitHub');

  // Print instructions clearly
  const line = '─'.repeat(44);
  console.log(`\n┌${line}┐`);
  console.log('│        GitHub Authentication Required          │');
  console.log(`├${line}┤`);
  console.log(`│  Visit:     ${verification_uri.padEnd(30)} │`);
  console.log(`│  Enter code: ${user_code.padEnd(29)} │`);
  console.log(`└${line}┘\n`);

  // Step 2 – poll until the user completes auth
  let pollMs = (interval || 5) * 1000;
  const expiresAt = Date.now() + (expires_in || 900) * 1000;

  while (Date.now() < expiresAt) {
    await new Promise(r => setTimeout(r, pollMs));

    const data = await githubPost('https://github.com/login/oauth/access_token', {
      client_id: CLIENT_ID,
      device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });

    if (data.access_token) {
      saveToken(data.access_token);
      console.log('Authentication successful! Token saved.\n');
      return data.access_token;
    }

    switch (data.error) {
      case 'authorization_pending': break; // keep polling
      case 'slow_down': pollMs = (data.interval || pollMs / 1000 + 5) * 1000; break;
      case 'access_denied': throw new Error('Access denied – user cancelled');
      case 'expired_token': throw new Error('Device code expired – restart the bot to try again');
      default: throw new Error(`Unexpected auth error: ${data.error}`);
    }
  }

  throw new Error('Authentication timed out');
}

/**
 * Returns a valid GitHub token, running the device flow if one isn't stored.
 * Priority: COPILOT_GITHUB_TOKEN env var → stored token file → device flow
 */
export async function ensureAuthenticated() {
  if (process.env.COPILOT_GITHUB_TOKEN) {
    return process.env.COPILOT_GITHUB_TOKEN;
  }

  const stored = loadStoredToken();
  if (stored) return stored;

  return deviceLogin();
}
