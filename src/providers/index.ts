import {
  openaiStream,
  anthropicStream,
  geminiStream,
  ollamaStream,
  DEFAULT_OLLAMA_BASE_URL,
  type ProviderMsg,
  type ToolSchema as HttpToolSchema,
  type HttpChunk,
  type StreamOptions,
} from './http-stream.js';

// ─── Shared types ─────────────────────────────────────────────────────────────

export type { ProviderMsg as ProviderMessage };
export { DEFAULT_OLLAMA_BASE_URL };

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type StreamChunk =
  | { type: 'text'; text: string }
  | {
      type: 'tool_call';
      id: string;
      name: string;
      args: Record<string, unknown>;
      /** Present on Gemini thinking-model responses; must be echoed back in history. */
      thoughtSignature?: string;
    };

export interface ChatOptions {
  model: string;
  systemPrompt: string;
  messages: ProviderMsg[];
  tools: ToolSchema[];
  /** False asks for one JSON reply; set it for models that cannot stream. */
  stream?: boolean;
}

export interface ProviderAdapter {
  chat(options: ChatOptions): AsyncIterable<StreamChunk>;
}

// ─── Known models ─────────────────────────────────────────────────────────────

export const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    requiresKey: true,
    models: [
      { id: 'gpt-5.5', label: 'GPT-5.5' },
      { id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro' },
      { id: 'gpt-5.4', label: 'GPT-5.4' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
      { id: 'o3', label: 'o3' },
      { id: 'o3-pro', label: 'o3 Pro' },
    ],
    default: 'gpt-5.4-mini',
  },
  anthropic: {
    label: 'Anthropic',
    requiresKey: true,
    models: [
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    ],
    default: 'claude-haiku-4-5',
  },
  gemini: {
    label: 'Google Gemini',
    requiresKey: true,
    models: [
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (preview)' },
      { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
    ],
    default: 'gemini-3.1-flash-lite',
  },
  freebuff: {
    label: 'Freebuff API',
    requiresKey: true,
    /**
     * OpenAI-compatible. `GET /api/v1/paid/models` is public and lists each
     * model's tool/streaming support; entries below are the tool-capable ones.
     */
    baseUrl: 'https://freebuff.com/api/v1/paid',
    models: [
      // The only model in the catalog that both streams and calls tools.
      { id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash (streaming)' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', streaming: false },
      { id: 'gpt-6-luna', label: 'GPT-6 Luna', streaming: false },
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', streaming: false },
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', streaming: false },
      { id: 'gemini-4-argon', label: 'Gemini 4 Argon', streaming: false },
      { id: 'qwen3.8-max', label: 'Qwen3.8 Max', streaming: false },
      { id: 'minimax-m3', label: 'MiniMax M3', streaming: false },
      { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', streaming: false },
    ],
    default: 'deepseek-v4.1-flash',
  },
  ollama: {
    label: 'Ollama (local)',
    requiresKey: false,
    models: [
      { id: 'gpt-oss:20b', label: 'gpt-oss:20b' },
      { id: 'gemma4:12b', label: 'gemma4:12b' },
      { id: 'gemma4:26b', label: 'gemma4:26b' },
      { id: 'llama3.1:8b', label: 'llama3.1:8b' },
    ],
    default: 'gpt-oss:20b',
  },
} as const;

export type ProviderId = keyof typeof PROVIDERS;

/** Whether chatting with this provider requires a stored API key. */
export function providerRequiresKey(providerId: string): boolean {
  const entry: { requiresKey?: boolean } | undefined = PROVIDERS[providerId as ProviderId];
  return entry?.requiresKey !== false;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export interface ProviderOptions {
  /** Base URL for local providers that expose an OpenAI-compatible API. */
  baseUrl?: string;
}

type StreamFn = (
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ProviderMsg[],
  tools: HttpToolSchema[],
  options?: StreamOptions,
) => AsyncGenerator<HttpChunk>;

/** Adapts the http-stream generators to the ProviderAdapter interface. */
function makeAdapter(fn: StreamFn) {
  return (apiKey: string, baseUrl?: string): ProviderAdapter => ({
    chat({ model, systemPrompt, messages, tools, stream }): AsyncIterable<StreamChunk> {
      return fn(apiKey, model, systemPrompt, messages, tools as HttpToolSchema[], {
        baseUrl,
        stream,
      }) as AsyncIterable<StreamChunk>;
    },
  });
}

const adapters = {
  openai: makeAdapter(openaiStream),
  // Freebuff's API is OpenAI-compatible; only the base URL differs.
  freebuff: makeAdapter(openaiStream),
  anthropic: makeAdapter(anthropicStream),
  gemini: makeAdapter(geminiStream),
  ollama: makeAdapter(ollamaStream),
};

export function createProvider(
  providerId: string,
  apiKey: string,
  options: ProviderOptions = {},
): ProviderAdapter {
  const factory = adapters[providerId as keyof typeof adapters];
  if (!factory) throw new Error(`Unknown provider: ${providerId}`);
  return factory(apiKey, options.baseUrl ?? providerBaseUrl(providerId));
}

/** Fixed API base URL of a provider that talks to a single endpoint (e.g. Freebuff). */
export function providerBaseUrl(providerId: string): string | undefined {
  const entry = PROVIDERS[providerId as ProviderId] as unknown as { baseUrl?: string } | undefined;
  return entry?.baseUrl;
}

/**
 * Whether a model streams. Registry entries marked `streaming: false` get one
 * JSON reply instead, which the OpenAI-compatible client replays as a stream.
 */
export function modelStreams(providerId: string, model: string): boolean {
  const entry: { models?: readonly { id: string; streaming?: boolean }[] } | undefined =
    PROVIDERS[providerId as ProviderId];
  const match = entry?.models?.find((item) => item.id === model);
  return match?.streaming !== false;
}
