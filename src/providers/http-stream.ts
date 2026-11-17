/**
 * Minimal streaming HTTPS client built on node:https.
 * No globals needed — uses only Node.js built-ins.
 */

import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';

/**
 * Parse the retry delay from a 429 body: Gemini/Google send `"retryDelay": "60s"`,
 * OpenAI-compatible servers send `"retry_after": 60`.
 */
/**
 * Whether a 429 body describes an unfunded account rather than a transient limit.
 * Retrying those only wastes time: the same request fails until someone pays.
 * "limit exceeded" is deliberately NOT permanent — gateways use it for per-minute
 * token budgets too (Freebuff answers "Paid API limit exceeded" when a turn's
 * rounds exceed 100k tokens/minute), and that clears on its own.
 */
export function isPermanentQuotaError(body: string): boolean {
  return /quota|insufficient|out of credits|balance is|billing/i.test(body);
}

export function parseRetryDelay(body: string): number {
  const gemini = body.match(/"retryDelay"\s*:\s*"(\d+)s"/);
  if (gemini) return parseInt(gemini[1], 10);
  const openai = body.match(/"retry_after"\s*:\s*(\d+)/);
  if (openai) return parseInt(openai[1], 10);
  return 60;
}

export interface HttpChunk {
  type: 'text' | 'tool_call';
  text?: string;
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
  /** Gemini thinking models attach this to every functionCall; must be round-tripped. */
  thoughtSignature?: string;
}

export type HttpChunkStream = AsyncGenerator<HttpChunk, void, unknown>;

interface ReqOptions {
  hostname: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  /** Transport protocol — defaults to https. Local servers (Ollama) use plain http. */
  protocol?: 'https' | 'http';
  /** Explicit port, e.g. 11434 for a default Ollama install. */
  port?: number;
}

/** How many times a 429 is retried before the turn fails. */
const MAX_RATE_LIMIT_RETRIES = 2;

/**
 * Make a streaming HTTPS POST and yield raw SSE/NDJSON lines.
 * A 429 is retried up to MAX_RATE_LIMIT_RETRIES times, waiting for the delay the
 * server asked for; the final error keeps the server's own explanation so the
 * cause (throttle, quota, overloaded upstream) stays visible.
 */
async function* streamLines(opts: ReqOptions): AsyncGenerator<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      yield* streamLinesRaw(opts);
      return;
    } catch (err) {
      const retryAfterMs =
        err instanceof Error && 'retryAfterMs' in err
          ? (err as Error & { retryAfterMs: number }).retryAfterMs
          : null;
      if (retryAfterMs === null) throw err;
      if (attempt >= MAX_RATE_LIMIT_RETRIES) {
        throw new Error(`${(err as Error).message} (gave up after ${attempt + 1} attempts)`, {
          cause: err,
        });
      }
      await new Promise<void>((resolve) => setTimeout(resolve, retryAfterMs));
    }
  }
}

async function* streamLinesRaw(opts: ReqOptions): AsyncGenerator<string> {
  const bodyStr = JSON.stringify(opts.body);

  const reqOpts: https.RequestOptions = {
    hostname: opts.hostname,
    path: opts.path,
    method: opts.method,
    ...(opts.port !== undefined ? { port: opts.port } : {}),
    headers: {
      ...opts.headers,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr).toString(),
    },
  };

  const transport = opts.protocol === 'http' ? http : https;

  const lines: string[] = [];
  let resolve: (() => void) | null = null;
  let done = false;
  let error: Error | null = null;

  // A provider that accepts the connection and then goes silent would hang the
  // turn forever — nothing else in this path has a timeout.
  const idleTimeoutMs = Number.parseInt(process.env.LIVE_AGENT_IDLE_TIMEOUT_MS ?? '', 10) || 90_000;
  let idleTimer: NodeJS.Timeout | null = null;
  const stopIdleTimer = (): void => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };
  const touchIdleTimer = (): void => {
    stopIdleTimer();
    idleTimer = setTimeout(() => {
      error = new Error(
        `Provider sent nothing for ${Math.round(idleTimeoutMs / 1000)}s — giving up`,
      );
      done = true;
      req.destroy();
      resolve?.();
    }, idleTimeoutMs);
  };

  const req = transport.request(reqOpts, (res: http.IncomingMessage) => {
    let buf = '';

    res.on('data', (chunk: Buffer) => {
      touchIdleTimer();
      buf += chunk.toString();
      const parts = buf.split('\n');
      buf = parts.pop() ?? '';
      for (const line of parts) {
        lines.push(line);
      }
      resolve?.();
    });

    res.on('end', () => {
      stopIdleTimer();
      if (buf) lines.push(buf);

      const status = res.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        // Collect everything buffered so far into a readable error message.
        const body = lines
          .join('\n')
          .replace(/^data: /gm, '')
          .trim();
        if (status === 429 && isPermanentQuotaError(body)) {
          // No retry: report the account's own reason immediately.
          error = new Error(`API quota exhausted (HTTP 429) — ${body.slice(0, 300)}`);
        } else if (status === 429) {
          const headerDelay = Number.parseInt(res.headers['retry-after'] ?? '', 10);
          const delaySec =
            Number.isFinite(headerDelay) && headerDelay > 0 ? headerDelay : parseRetryDelay(body);
          // Keep the body: it is the only place the server explains WHY it throttled.
          const detail = body ? ` — ${body.slice(0, 300)}` : '';
          error = Object.assign(new Error(`Rate-limited (HTTP 429)${detail}`), {
            retryAfterMs: delaySec * 1000,
          });
        } else {
          error = new Error(`HTTP ${status}: ${body.slice(0, 500)}`);
        }
      }

      done = true;
      resolve?.();
    });

    res.on('error', (err: Error) => {
      stopIdleTimer();
      error = err;
      done = true;
      resolve?.();
    });
  });

  req.on('error', (err: Error) => {
    stopIdleTimer();
    error = err;
    done = true;
    resolve?.();
  });

  req.write(bodyStr);
  req.end();
  touchIdleTimer();

  try {
    while (true) {
      while (lines.length > 0) {
        yield lines.shift()!;
      }
      if (done) break;
      await new Promise<void>((r) => {
        resolve = r;
      });
      resolve = null;
    }

    if (error) throw error;
  } finally {
    stopIdleTimer();
    // Callers stop reading at [DONE], never at EOF, so without this the socket
    // stays open until the server times it out. Gateways that meter concurrent
    // requests keep counting the finished one as active, and the next round in
    // the same turn is rejected with a limit error.
    if (!req.destroyed) req.destroy();
  }
}

// ── OpenAI-compatible (OpenAI, Ollama) ──────────────────────────────────────

/** Default endpoint for OpenAI's chat-completions API. */
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

/** Per-call transport options shared by the OpenAI-compatible stream functions. */
export interface StreamOptions {
  /** Base URL of an OpenAI-compatible API; ignored by providers with a fixed endpoint. */
  baseUrl?: string;
  /**
   * Ask for SSE deltas (the default). `false` requests a single JSON reply, which
   * some OpenAI-compatible servers require for models that cannot stream.
   */
  stream?: boolean;
}

/** Splits an OpenAI-compatible base URL into the request coordinates for `/chat/completions`. */
export function openaiRequestTarget(baseUrl?: string): {
  hostname: string;
  path: string;
  protocol: 'https' | 'http';
  port?: number;
} {
  const raw = (baseUrl ?? '').trim() || DEFAULT_OPENAI_BASE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid base URL "${raw}"`);
  }
  // Tolerate a trailing slash; keep any path prefix (e.g. /api/v1/paid).
  const rootPath = url.pathname.replace(/\/+$/, '');
  return {
    hostname: url.hostname,
    path: `${rootPath}/chat/completions`,
    protocol: url.protocol === 'http:' ? 'http' : 'https',
    ...(url.port ? { port: Number.parseInt(url.port, 10) } : {}),
  };
}

/** Shape of a non-streamed OpenAI chat completion. */
interface OAICompletion {
  error?: { message?: string };
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
    };
  }>;
}

/**
 * Reads a single non-streamed completion body into text and tool calls.
 * Used for OpenAI-compatible models whose catalog entry cannot stream; the
 * chunks are then replayed so callers see the same shape as an SSE turn.
 */
export function parseOpenAICompletion(body: string): {
  text: string;
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
} {
  let parsed: OAICompletion;
  try {
    parsed = JSON.parse(body) as OAICompletion;
  } catch {
    throw new Error(`Unreadable response: ${body.slice(0, 200)}`);
  }
  if (parsed.error) throw new Error(parsed.error.message ?? 'Provider returned an error');

  const message = parsed.choices?.[0]?.message;
  const text = message?.content ?? '';
  const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
  for (const call of message?.tool_calls ?? []) {
    const name = call.function?.name;
    if (!name) continue;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function?.arguments || '{}') as Record<string, unknown>;
    } catch {
      /* leave empty — the agent loop surfaces a schema error for the model to fix */
    }
    toolCalls.push({ id: call.id ?? `call_${toolCalls.length}`, name, args });
  }
  return { text, toolCalls };
}

interface OAIToolCallDelta {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

export async function* openaiStream(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ProviderMsg[],
  tools: ToolSchema[],
  options: StreamOptions = {},
): HttpChunkStream {
  const body = {
    model,
    messages: buildOAIMessages(systemPrompt, messages),
    tools: tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    })),
    stream: options.stream !== false,
  };

  const partialCalls: Record<number, { id: string; name: string; args: string }> = {};
  // Non-SSE servers answer with one JSON document. Buffer those lines so they can
  // be parsed after the stream ends instead of being dropped on the floor.
  const rawLines: string[] = [];
  let sawSse = false;

  for await (const line of streamLines({
    ...openaiRequestTarget(options.baseUrl),
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
  })) {
    if (!line.startsWith('data: ')) {
      if (line.trim()) rawLines.push(line);
      continue;
    }
    sawSse = true;
    const data = line.slice(6).trim();
    if (data === '[DONE]') break;

    let chunk: {
      choices: Array<{
        delta: { content?: string; tool_calls?: OAIToolCallDelta[] };
        finish_reason?: string;
      }>;
    };
    try {
      chunk = JSON.parse(data);
    } catch {
      continue;
    }

    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;

    if (delta.content) yield { type: 'text', text: delta.content };

    for (const tc of delta.tool_calls ?? []) {
      if (!partialCalls[tc.index]) {
        partialCalls[tc.index] = { id: tc.id ?? '', name: tc.function?.name ?? '', args: '' };
      }
      const pc = partialCalls[tc.index];
      if (tc.id) pc.id = tc.id;
      if (tc.function?.name) pc.name = tc.function.name;
      if (tc.function?.arguments) pc.args += tc.function.arguments;
    }

    if (chunk.choices?.[0]?.finish_reason === 'tool_calls') {
      for (const pc of Object.values(partialCalls)) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(pc.args);
        } catch {
          /* leave empty */
        }
        yield { type: 'tool_call', id: pc.id, name: pc.name, args };
      }
    }
  }

  if (!sawSse && rawLines.length > 0) {
    const { text, toolCalls } = parseOpenAICompletion(rawLines.join('\n'));
    if (text) yield { type: 'text', text };
    for (const call of toolCalls) {
      yield { type: 'tool_call', id: call.id, name: call.name, args: call.args };
    }
  }
}

// ── Ollama (local, native API) ─────────────────────────────────────────────

/** Default base URL of a local Ollama server. */
export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

/**
 * Context window requested from Ollama, which defaults to 4096.
 * The agent's system prompt (live session state) plus ~48 tool schemas needs
 * far more than that; when Ollama truncates, models stop emitting tool calls
 * and print JSON as prose instead.
 * Override with `LIVE_AGENT_NUM_CTX` (lower it on memory-constrained machines).
 */
const OLLAMA_DEFAULT_NUM_CTX = 32768;

/** Keeps the model resident between turns; Ollama's own default unloads after 5 minutes. */
const OLLAMA_KEEP_ALIVE = '30m';

/** Parses `LIVE_AGENT_NUM_CTX`, falling back to the default for anything invalid. */
export function resolveOllamaNumCtx(raw: string | undefined): number {
  const value = Number.parseInt((raw ?? '').trim(), 10);
  return Number.isFinite(value) && value > 0 ? value : OLLAMA_DEFAULT_NUM_CTX;
}

/** Tool-call shape returned by Ollama's native `/api/chat`. */
interface OllamaToolCall {
  function?: { name?: string; arguments?: unknown };
}

/** Serialises conversation history into Ollama's native message format. */
export function buildOllamaMessages(systemPrompt: string, messages: ProviderMsg[]): unknown[] {
  const result: unknown[] = [{ role: 'system', content: systemPrompt }];
  for (const m of messages) {
    if (m.role === 'assistant' && m.toolCall) {
      result.push({
        role: 'assistant',
        content: m.content || '',
        tool_calls: [{ function: { name: m.toolCall.name, arguments: m.toolCall.args } }],
      });
    } else if (m.role === 'tool') {
      result.push({ role: 'tool', content: m.content, tool_name: m.toolName });
    } else {
      result.push({ role: m.role, content: m.content });
    }
  }
  return result;
}

/** Parses Ollama's newline-delimited JSON chat stream into chunks. */
export async function* parseOllamaStream(lines: AsyncGenerator<string>): HttpChunkStream {
  let counter = 0;

  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let chunk: {
      message?: { content?: string; tool_calls?: OllamaToolCall[] };
      error?: string;
    };
    try {
      chunk = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (chunk.error) throw new Error(`Ollama: ${chunk.error}`);
    if (chunk.message?.content) yield { type: 'text', text: chunk.message.content };

    for (const call of chunk.message?.tool_calls ?? []) {
      const name = call.function?.name;
      if (!name) continue;

      // Native responses carry an object, but older builds stringify it.
      let args = call.function?.arguments;
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch {
          args = {};
        }
      }

      yield {
        type: 'tool_call',
        id: `call_${Date.now()}_${counter++}`,
        name,
        args: (args ?? {}) as Record<string, unknown>,
      };
    }
  }
}

/**
 * Streams a chat completion from a local Ollama server using its native API,
 * the only endpoint that accepts `options.num_ctx`.
 * `apiKey` is optional — it is only sent when the server sits behind a proxy.
 */
export async function* ollamaStream(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ProviderMsg[],
  tools: ToolSchema[],
  options: StreamOptions = {},
): HttpChunkStream {
  const url = new URL((options.baseUrl ?? '').trim() || DEFAULT_OLLAMA_BASE_URL);
  // Tolerate a pasted OpenAI-style URL such as http://localhost:11434/v1.
  const rootPath = url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '');

  yield* parseOllamaStream(
    streamLines({
      hostname: url.hostname,
      path: `${rootPath}/api/chat`,
      method: 'POST',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      body: {
        model,
        messages: buildOllamaMessages(systemPrompt, messages),
        ...(tools.length > 0
          ? {
              tools: tools.map((t) => ({
                type: 'function',
                function: { name: t.name, description: t.description, parameters: t.parameters },
              })),
            }
          : {}),
        stream: true,
        options: { num_ctx: resolveOllamaNumCtx(process.env.LIVE_AGENT_NUM_CTX) },
        keep_alive: OLLAMA_KEEP_ALIVE,
      },
      protocol: url.protocol === 'http:' ? 'http' : 'https',
      port: url.port ? Number.parseInt(url.port, 10) : undefined,
    }),
  );
}

// ── Anthropic ────────────────────────────────────────────────────────────────

export async function* anthropicStream(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ProviderMsg[],
  tools: ToolSchema[],
): HttpChunkStream {
  const body = {
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: buildAnthropicMessages(messages),
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    })),
    stream: true,
  };

  let currentToolId = '';
  let currentToolName = '';
  let currentToolArgs = '';

  for await (const line of streamLines({
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body,
  })) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();

    let ev: {
      type: string;
      index?: number;
      delta?: { type: string; text?: string; partial_json?: string };
      content_block?: { type: string; id?: string; name?: string };
    };
    try {
      ev = JSON.parse(data);
    } catch {
      continue;
    }

    if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
      currentToolId = ev.content_block.id ?? '';
      currentToolName = ev.content_block.name ?? '';
      currentToolArgs = '';
    } else if (ev.type === 'content_block_delta') {
      if (ev.delta?.type === 'text_delta' && ev.delta.text) {
        yield { type: 'text', text: ev.delta.text };
      } else if (ev.delta?.type === 'input_json_delta' && ev.delta.partial_json) {
        currentToolArgs += ev.delta.partial_json;
      }
    } else if (ev.type === 'content_block_stop' && currentToolName) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(currentToolArgs);
      } catch {
        /* leave empty */
      }
      yield { type: 'tool_call', id: currentToolId, name: currentToolName, args };
      currentToolName = '';
      currentToolArgs = '';
    }
  }
}

// ── Google Gemini ────────────────────────────────────────────────────────────

export async function* geminiStream(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ProviderMsg[],
  tools: ToolSchema[],
): HttpChunkStream {
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: buildGeminiContents(messages),
    tools: [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
    ],
  };

  let jsonBuf = '';

  for await (const line of streamLines({
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`,
    method: 'POST',
    headers: {},
    body,
  })) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    jsonBuf += data;

    let chunk: {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
            thought?: boolean;
            functionCall?: {
              name: string;
              args: Record<string, unknown>;
              thought_signature?: string;
            };
          }>;
        };
      }>;
    };
    try {
      chunk = JSON.parse(jsonBuf);
      jsonBuf = '';
    } catch {
      continue;
    }

    for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
      // Skip internal "thought" text parts — they're reasoning traces, not output.
      if (part.thought) continue;
      if (part.text) yield { type: 'text', text: part.text };
      if (part.functionCall) {
        yield {
          type: 'tool_call',
          id: `gemini-${Date.now()}`,
          name: part.functionCall.name,
          args: part.functionCall.args,
          thoughtSignature: part.functionCall.thought_signature,
        };
      }
    }
  }
}

// ── Shared types & helpers ───────────────────────────────────────────────────

export interface ProviderMsg {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCall?: {
    id: string;
    name: string;
    args: Record<string, unknown>;
    /** Gemini thinking models attach this; must be echoed back in multi-turn requests. */
    thoughtSignature?: string;
  };
  toolCallId?: string;
  /** Name of the tool that produced this result (required by Gemini's functionResponse). */
  toolName?: string;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

function buildOAIMessages(systemPrompt: string, messages: ProviderMsg[]): unknown[] {
  const result: unknown[] = [{ role: 'system', content: systemPrompt }];
  for (const m of messages) {
    if (m.role === 'assistant' && m.toolCall) {
      result.push({
        role: 'assistant',
        content: m.content || null,
        tool_calls: [
          {
            id: m.toolCall.id,
            type: 'function',
            function: { name: m.toolCall.name, arguments: JSON.stringify(m.toolCall.args) },
          },
        ],
      });
    } else if (m.role === 'tool') {
      result.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    } else {
      result.push({ role: m.role, content: m.content });
    }
  }
  return result;
}

function buildAnthropicMessages(messages: ProviderMsg[]): unknown[] {
  const result: unknown[] = [];
  for (const m of messages) {
    if (m.role === 'assistant' && m.toolCall) {
      result.push({
        role: 'assistant',
        content: [
          ...(m.content ? [{ type: 'text', text: m.content }] : []),
          { type: 'tool_use', id: m.toolCall.id, name: m.toolCall.name, input: m.toolCall.args },
        ],
      });
    } else if (m.role === 'tool') {
      result.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }],
      });
    } else {
      result.push({ role: m.role, content: m.content });
    }
  }
  return result;
}

function buildGeminiContents(messages: ProviderMsg[]): unknown[] {
  // Gemini thinking models require every functionCall to carry a thought_signature.
  // History entries from older sessions or non-thinking runs won't have it.
  // Build an allow-list of tool-call IDs that do have a signature; skip the rest
  // (both the call and its paired result) to avoid INVALID_ARGUMENT errors.
  const validIds = new Set<string>();
  for (const m of messages) {
    if (m.role === 'assistant' && m.toolCall?.id && m.toolCall.thoughtSignature) {
      validIds.add(m.toolCall.id);
    }
  }

  const result: unknown[] = [];
  for (const m of messages) {
    if (m.role === 'assistant' && m.toolCall) {
      if (!m.toolCall.thoughtSignature) {
        // No signature — keep any text the assistant said, but drop the call.
        if (m.content) result.push({ role: 'model', parts: [{ text: m.content }] });
        continue;
      }
      const fc: Record<string, unknown> = {
        name: m.toolCall.name,
        args: m.toolCall.args,
        thought_signature: m.toolCall.thoughtSignature,
      };
      result.push({ role: 'model', parts: [{ functionCall: fc }] });
      continue;
    }
    if (m.role === 'tool') {
      // Skip results whose call was dropped above.
      if (m.toolCallId && !validIds.has(m.toolCallId)) continue;
      result.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: m.toolName ?? m.toolCallId ?? '',
              response: { content: m.content },
            },
          },
        ],
      });
      continue;
    }
    result.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
  }
  return result;
}
