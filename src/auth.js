import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// GitHub OAuth App client_id for device flow.
// Using the GitHub Copilot for Neovim client (widely used for Copilot access).
const CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const SCOPE = 'user read:org gist';

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

/** Use the gh CLI's stored token if available — it always has the right scopes. */
function getGhCliToken() {
  try {
    const token = execSync('gh auth token', {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return token || null;
  } catch {
    return null;
  }
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

  // Print instructions with dynamic box sizing
  const INNER = Math.max(verification_uri.length, user_code.length) + 18;
  const dashes = '─'.repeat(INNER);
  const center = (text) => {
    const pad = INNER - text.length;
    return '│' + ' '.repeat(Math.floor(pad / 2)) + text + ' '.repeat(Math.ceil(pad / 2)) + '│';
  };
  const left = (prefix, value) => {
    const text = prefix + value;
    return '│ ' + text + ' '.repeat(INNER - text.length - 2) + ' │';
  };

  console.log(`\n┌${dashes}┐`);
  console.log(center('GitHub Authentication Required'));
  console.log(`├${dashes}┤`);
  console.log(left('Visit:      ', verification_uri));
  console.log(left('Enter code: ', user_code));
  console.log(`└${dashes}┘\n`);

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
      case 'authorization_pending': break;
      case 'slow_down': pollMs = (data.interval || pollMs / 1000 + 5) * 1000; break;
      case 'access_denied': throw new Error('Access denied – user cancelled');
      case 'expired_token': throw new Error('Device code expired – restart the bot to try again');
      default: throw new Error(`Unexpected auth error: ${data.error}`);
    }
  }

  throw new Error('Authentication timed out');
}

/**
 * Returns a valid GitHub token.
 *
 * Priority:
 *   1. COPILOT_GITHUB_TOKEN env var (explicit override)
 *   2. Stored .cobot-auth.json token (from a previous run)
 *   3. gh CLI token (`gh auth token`) — used in Codespaces and gh-authenticated machines
 *   4. GitHub device flow (prompts the user to authorize in a browser)
 */
export async function ensureAuthenticated() {
  // 1. Explicit env var
  if (process.env.COPILOT_GITHUB_TOKEN) return process.env.COPILOT_GITHUB_TOKEN;

  // 2. Stored token from previous auth
  const stored = loadStoredToken();
  if (stored) return stored;

  // 3. gh CLI (no user interaction needed — token is already there)
  const ghToken = getGhCliToken();
  if (ghToken) {
    saveToken(ghToken);
    return ghToken;
  }

  // 4. Interactive device flow
  return deviceLogin();
}
