import fs from 'node:fs';

/** File written by `scripts/choose-model.ts` at the project root before `npm start`. */
export const STARTUP_CHOICE_FILENAME = 'live-agent.config.json';

export interface StartupChoice {
  provider: string;
  model: string;
}

/** Minimal storage surface needed to apply a choice — keeps this unit-testable. */
export interface LastChoiceTarget {
  saveLastChoice(provider: string, model: string): void;
}

/**
 * Applies a one-shot provider/model choice written before startup, then deletes
 * the file so later launches fall back to the in-app last choice.
 * Returns the applied choice, or null when there is nothing valid to apply.
 */
export function applyStartupChoice(
  configPath: string,
  target: LastChoiceTarget,
): StartupChoice | null {
  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Partial<StartupChoice>;
    if (!parsed.provider || !parsed.model) {
      console.error('[Live Agent] Startup config needs both "provider" and "model" — ignoring.');
      return null;
    }
    target.saveLastChoice(parsed.provider, parsed.model);
    return { provider: parsed.provider, model: parsed.model };
  } catch (err) {
    console.error('[Live Agent] Failed to read startup model config:', err);
    return null;
  } finally {
    try {
      fs.rmSync(configPath, { force: true });
    } catch {
      // Best effort — a stale file is harmless, it is re-read on the next launch.
    }
  }
}
