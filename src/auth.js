import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';

// Path to the bundled Copilot CLI binary (installed as a dependency)
const COPILOT_BIN = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', 'node_modules', '.bin', 'copilot',
);

// ~/.copilot/config.json stores the list of logged-in users after copilot login
const COPILOT_CONFIG = path.join(os.homedir(), '.copilot', 'config.json');

/**
 * Returns true if the Copilot CLI already has stored credentials.
 * The CLI writes to ~/.copilot/config.json with a non-empty logged_in_users list.
 */
function isCopilotLoggedIn() {
  try {
    if (!fs.existsSync(COPILOT_CONFIG)) return false;
    const { logged_in_users } = JSON.parse(fs.readFileSync(COPILOT_CONFIG, 'utf8'));
    return Array.isArray(logged_in_users) && logged_in_users.length > 0;
  } catch {
    return false;
  }
}

/** Returns a gh CLI token if available (gh tokens are accepted by the Copilot CLI). */
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

/**
 * Runs `copilot login` interactively.
 * The CLI handles the device flow itself: shows a URL + code, polls GitHub,
 * and stores the token securely in ~/.copilot/ when done.
 */
async function runCopilotLogin() {
  console.log('\nNo GitHub authentication found. Starting Copilot login...\n');
  await new Promise((resolve, reject) => {
    const proc = spawn(COPILOT_BIN, ['login'], { stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`copilot login exited with code ${code}`));
    });
    proc.on('error', (err) => reject(new Error(`Failed to run copilot login: ${err.message}`)));
  });
}

/**
 * Resolves to a valid GitHub token, or null when the Copilot CLI manages auth itself.
 *
 * Priority:
 *   1. COPILOT_GITHUB_TOKEN env var — fine-grained PAT with "Copilot Requests" permission
 *   2. gh CLI token (`gh auth token`) — accepted by the Copilot CLI
 *   3. Previously stored copilot login credentials (~/.copilot/config.json)
 *   4. Interactive `copilot login` device flow (one-time per machine/container)
 */
export async function ensureAuthenticated() {
  // 1. Explicit fine-grained PAT
  if (process.env.COPILOT_GITHUB_TOKEN) return process.env.COPILOT_GITHUB_TOKEN;

  // 2. gh CLI token (automatically available in Codespaces, GitHub Actions, etc.)
  const ghToken = getGhCliToken();
  if (ghToken) return ghToken;

  // 3. Already logged in via a previous `copilot login` run
  if (isCopilotLoggedIn()) return null; // CLI will find its own stored credentials

  // 4. Interactive device flow via the Copilot CLI
  await runCopilotLogin();
  return null; // CLI will find the credentials it just stored
}
