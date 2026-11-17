import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyStartupChoice } from './startup-choice.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-agent-choice-'));
  dirs.push(dir);
  return dir;
}

function recorder() {
  const calls: Array<{ provider: string; model: string }> = [];
  return {
    calls,
    saveLastChoice: (provider: string, model: string) => calls.push({ provider, model }),
  };
}

afterEach(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

describe('applyStartupChoice', () => {
  it('applies the written choice and deletes the one-shot config', () => {
    const configPath = path.join(tempDir(), 'live-agent.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ provider: 'ollama', model: 'gemma4:12b' }));
    const target = recorder();

    expect(applyStartupChoice(configPath, target)).toEqual({
      provider: 'ollama',
      model: 'gemma4:12b',
    });
    expect(target.calls).toEqual([{ provider: 'ollama', model: 'gemma4:12b' }]);
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it('does nothing when no config file exists', () => {
    const target = recorder();
    expect(applyStartupChoice(path.join(tempDir(), 'live-agent.config.json'), target)).toBeNull();
    expect(target.calls).toEqual([]);
  });

  it('ignores and removes an incomplete config', () => {
    const configPath = path.join(tempDir(), 'live-agent.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ model: 'llama3.1:8b' }));
    const target = recorder();

    expect(applyStartupChoice(configPath, target)).toBeNull();
    expect(target.calls).toEqual([]);
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it('ignores and removes malformed JSON', () => {
    const configPath = path.join(tempDir(), 'live-agent.config.json');
    fs.writeFileSync(configPath, '{not json');
    const target = recorder();

    expect(applyStartupChoice(configPath, target)).toBeNull();
    expect(target.calls).toEqual([]);
    expect(fs.existsSync(configPath)).toBe(false);
  });
});
