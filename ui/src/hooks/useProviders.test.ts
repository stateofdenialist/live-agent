import { describe, it, expect } from 'vitest';
import { getProviderDefaultModel, resolveProviderChoice } from './useProviders.js';
import type { ProvidersRegistry } from '../types.js';

/** Stand-in for the registry the extension host sends with the settings frame. */
const REGISTRY: ProvidersRegistry = {
  openai: {
    label: 'OpenAI',
    default: 'gpt-5.4-mini',
    models: [
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
      { id: 'gpt-5.4', label: 'GPT-5.4' },
    ],
  },
  anthropic: {
    label: 'Anthropic',
    default: 'claude-haiku-4-5',
    models: [{ id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' }],
  },
  gemini: {
    label: 'Google Gemini',
    default: 'gemini-3.1-flash-lite',
    models: [
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
      { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
    ],
  },
  ollama: {
    label: 'Ollama (local)',
    default: 'gpt-oss:20b',
    requiresKey: false,
    models: [{ id: 'gpt-oss:20b', label: 'gpt-oss:20b' }],
  },
};

describe('getProviderDefaultModel', () => {
  it('returns the default model for each known provider', () => {
    expect(getProviderDefaultModel(REGISTRY, 'openai')).toBe('gpt-5.4-mini');
    expect(getProviderDefaultModel(REGISTRY, 'anthropic')).toBe('claude-haiku-4-5');
    expect(getProviderDefaultModel(REGISTRY, 'gemini')).toBe('gemini-3.1-flash-lite');
  });

  it('returns gpt-oss:20b as the local Ollama default', () => {
    expect(getProviderDefaultModel(REGISTRY, 'ollama')).toBe('gpt-oss:20b');
  });

  it('returns empty string for unknown providers', () => {
    expect(getProviderDefaultModel(REGISTRY, 'unknown')).toBe('');
  });
});

describe('resolveProviderChoice', () => {
  it('falls back to gemini and flash-lite when unset', () => {
    expect(resolveProviderChoice(REGISTRY)).toEqual({
      provider: 'gemini',
      model: 'gemini-3.1-flash-lite',
    });
  });

  it('uses persisted provider and model when valid', () => {
    expect(resolveProviderChoice(REGISTRY, 'openai', 'gpt-5.4')).toEqual({
      provider: 'openai',
      model: 'gpt-5.4',
    });
  });

  it('accepts the persisted local Ollama choice', () => {
    expect(resolveProviderChoice(REGISTRY, 'ollama', 'gpt-oss:20b')).toEqual({
      provider: 'ollama',
      model: 'gpt-oss:20b',
    });
  });

  it('falls back to provider default when model is invalid', () => {
    expect(resolveProviderChoice(REGISTRY, 'anthropic', 'not-a-model')).toEqual({
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
    });
  });

  it('falls back to gemini when the persisted provider is gone', () => {
    expect(resolveProviderChoice(REGISTRY, 'removed-provider', 'anything')).toEqual({
      provider: 'gemini',
      model: 'gemini-3.1-flash-lite',
    });
  });

  it('uses the first registry entry when gemini is absent', () => {
    const withoutGemini: ProvidersRegistry = {
      openai: REGISTRY.openai,
      anthropic: REGISTRY.anthropic,
      ollama: REGISTRY.ollama,
    };
    expect(resolveProviderChoice(withoutGemini)).toEqual({
      provider: 'openai',
      model: 'gpt-5.4-mini',
    });
  });

  it('stays empty when no registry has arrived yet', () => {
    expect(resolveProviderChoice({})).toEqual({ provider: '', model: '' });
  });
});
