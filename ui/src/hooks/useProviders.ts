import { useCallback, useMemo, useState } from 'react';
import type { ProvidersRegistry } from '../types';

/** Default endpoint of a local Ollama server. */
export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

/** Provider preferred when nothing has been persisted yet. */
const FALLBACK_PROVIDER = 'gemini';

/** Settings fields needed to restore the last provider/model choice. */
export interface ProviderSettings {
  providers?: ProvidersRegistry;
  lastProvider?: string;
  lastModel?: string;
}

/**
 * Returns the default model id for a provider, or an empty string when unknown.
 * @param providers - Registry sent by the extension host.
 * @param providerId - Provider key within that registry.
 */
export function getProviderDefaultModel(providers: ProvidersRegistry, providerId: string): string {
  return providers[providerId]?.default ?? '';
}

/**
 * Resolves provider/model from persisted last-used values against the registry,
 * falling back to the free-tier default when either is unknown.
 * @param providers - Registry sent by the extension host.
 * @param lastProvider - Persisted provider id, if any.
 * @param lastModel - Persisted model id, if any.
 */
export function resolveProviderChoice(
  providers: ProvidersRegistry,
  lastProvider?: string,
  lastModel?: string,
): { provider: string; model: string } {
  const provider =
    lastProvider && providers[lastProvider]
      ? lastProvider
      : providers[FALLBACK_PROVIDER]
        ? FALLBACK_PROVIDER
        : (Object.keys(providers)[0] ?? '');
  const models = providers[provider]?.models ?? [];
  const defaultModel = getProviderDefaultModel(providers, provider);
  const model =
    lastModel && models.some((entry) => entry.id === lastModel) ? lastModel : defaultModel;
  return { provider, model };
}

export interface UseProvidersReturn {
  providers: ProvidersRegistry;
  provider: string;
  model: string;
  models: { id: string; label: string }[];
  setProvider: (p: string) => void;
  setModel: (m: string) => void;
  /** Applies the registry and persisted last-used choice from a settings message. */
  applySettings: (settings: ProviderSettings) => void;
}

/**
 * Manages the currently selected provider and model.
 * The registry comes from the extension host, so provider and model lists are
 * defined once in `src/providers/index.ts`. Both values stay empty until the
 * first settings message arrives.
 */
export function useProviders(
  onChoiceChange?: (provider: string, model: string) => void,
): UseProvidersReturn {
  const [providers, setProviders] = useState<ProvidersRegistry>({});
  const [provider, setProviderRaw] = useState('');
  const [model, setModelRaw] = useState('');

  const models = useMemo(() => providers[provider]?.models ?? [], [providers, provider]);

  const notifyChange = useCallback(
    (p: string, m: string) => {
      onChoiceChange?.(p, m);
    },
    [onChoiceChange],
  );

  const applySettings = useCallback((settings: ProviderSettings) => {
    const registry = settings.providers ?? {};
    const resolved = resolveProviderChoice(registry, settings.lastProvider, settings.lastModel);
    setProviders(registry);
    setProviderRaw(resolved.provider);
    setModelRaw(resolved.model);
  }, []);

  const setProvider = useCallback(
    (p: string) => {
      const defaultModel = getProviderDefaultModel(providers, p);
      setProviderRaw(p);
      setModelRaw(defaultModel);
      notifyChange(p, defaultModel);
    },
    [notifyChange, providers],
  );

  const setModel = useCallback(
    (m: string) => {
      setModelRaw(m);
      notifyChange(provider, m);
    },
    [notifyChange, provider],
  );

  return {
    providers,
    provider,
    model,
    models,
    setProvider,
    setModel,
    applySettings,
  };
}
