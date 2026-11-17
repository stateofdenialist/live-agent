import { describe, it, expect } from 'vitest';
import { createProvider, providerRequiresKey, PROVIDERS } from './index.js';

describe('createProvider', () => {
  it('throws for an unknown provider id', () => {
    expect(() => createProvider('unknown', 'key')).toThrow('Unknown provider');
    expect(() => createProvider('', 'key')).toThrow('Unknown provider');
  });

  it('returns an adapter with a chat() method for each known provider', () => {
    for (const id of Object.keys(PROVIDERS)) {
      const adapter = createProvider(id, 'test-key-not-real');
      expect(typeof adapter.chat).toBe('function');
    }
  });
});

describe('providerRequiresKey', () => {
  it('requires a key for cloud providers only', () => {
    expect(providerRequiresKey('openai')).toBe(true);
    expect(providerRequiresKey('anthropic')).toBe(true);
    expect(providerRequiresKey('gemini')).toBe(true);
    expect(providerRequiresKey('ollama')).toBe(false);
  });

  it('defaults to requiring a key for unknown providers', () => {
    expect(providerRequiresKey('not-a-provider')).toBe(true);
  });
});

describe('PROVIDERS registry', () => {
  it('defines openai, anthropic, gemini, and ollama', () => {
    expect(PROVIDERS).toHaveProperty('openai');
    expect(PROVIDERS).toHaveProperty('anthropic');
    expect(PROVIDERS).toHaveProperty('gemini');
    expect(PROVIDERS).toHaveProperty('ollama');
  });

  it('offers the installed local Ollama models', () => {
    expect(PROVIDERS.ollama.default).toBe('gpt-oss:20b');
    expect(PROVIDERS.ollama.requiresKey).toBe(false);
    expect(PROVIDERS.ollama.models.map((m) => m.id)).toEqual([
      'gpt-oss:20b',
      'gemma4:12b',
      'gemma4:26b',
      'llama3.1:8b',
    ]);
  });

  it('each provider has a non-empty label', () => {
    for (const [id, config] of Object.entries(PROVIDERS)) {
      expect(config.label.length, `${id} has empty label`).toBeGreaterThan(0);
    }
  });

  it('each provider has at least one model', () => {
    for (const [id, config] of Object.entries(PROVIDERS)) {
      expect(config.models.length, `${id} has no models`).toBeGreaterThan(0);
    }
  });

  it("each provider's default model is in its models list", () => {
    for (const [id, config] of Object.entries(PROVIDERS)) {
      const modelIds = config.models.map((m) => m.id);
      expect(modelIds, `${id} default '${config.default}' not in model list`).toContain(
        config.default,
      );
    }
  });

  it('each model has a non-empty id and label', () => {
    for (const [id, config] of Object.entries(PROVIDERS)) {
      for (const model of config.models) {
        expect(model.id.length, `${id} model has empty id`).toBeGreaterThan(0);
        expect(model.label.length, `${id} model has empty label`).toBeGreaterThan(0);
      }
    }
  });
});
