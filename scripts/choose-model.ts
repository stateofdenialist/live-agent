/**
 * Local model picker for `npm start`.
 *
 * Writes `live-agent.config.json` at the project root; the extension applies it
 * on activate and deletes it, so the choice applies to this launch only.
 *
 * Non-interactive override: LIVE_AGENT_MODEL=gemma4:12b npm start
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { PROVIDERS } from '../src/providers/index.js';

const OLLAMA_TAGS_URL = 'http://localhost:11434/api/tags';
const CONFIG_FILENAME = 'live-agent.config.json';
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, CONFIG_FILENAME);

const MODELS = PROVIDERS.ollama.models;

/** Names of models Ollama currently has on disk; empty when it is unreachable. */
async function installedModels(): Promise<Set<string>> {
  try {
    const res = await fetch(OLLAMA_TAGS_URL, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return new Set();
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return new Set((data.models ?? []).map((entry) => entry.name));
  } catch {
    return new Set();
  }
}

function writeChoice(model: string): void {
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify({ provider: 'ollama', model }, null, 2)}\n`);
  console.log(`→ ${model} will be selected when Live Agent starts.`);
}

function statusLabel(id: string, installed: Set<string>): string {
  if (installed.size === 0) return 'Ollama not reachable';
  return installed.has(id) ? 'installed' : 'not pulled yet';
}

async function main(): Promise<void> {
  const envModel = process.env.LIVE_AGENT_MODEL?.trim();
  if (envModel) {
    if (!MODELS.some((entry) => entry.id === envModel)) {
      console.error(
        `Unknown model "${envModel}". Choose one of: ${MODELS.map((entry) => entry.id).join(', ')}`,
      );
      process.exitCode = 1;
      return;
    }
    writeChoice(envModel);
    return;
  }

  if (!process.stdin.isTTY) {
    console.log('[startup] No terminal available — keeping the last-used model.');
    return;
  }

  const installed = await installedModels();

  console.log('\nLocal models:');
  MODELS.forEach((entry, index) => {
    console.log(`  ${index + 1}. ${entry.id.padEnd(14)} ${statusLabel(entry.id, installed)}`);
  });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (
      await rl.question(`\nPick a model [1-${MODELS.length}] (Enter keeps the last used): `)
    ).trim();

    if (!answer) {
      console.log('Keeping the last-used model.');
      return;
    }

    const chosen = MODELS[Number.parseInt(answer, 10) - 1];
    if (!chosen) {
      console.error(`Invalid choice "${answer}" — keeping the last-used model.`);
      return;
    }

    writeChoice(chosen.id);
  } finally {
    rl.close();
  }
}

await main();
