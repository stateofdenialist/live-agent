import { describe, it, expect } from 'vitest';
import {
  isPermanentQuotaError,
  openaiRequestTarget,
  parseOpenAICompletion,
  parseRetryDelay,
} from './http-stream.js';
import { modelStreams, providerBaseUrl, PROVIDERS } from './index.js';

describe('openaiRequestTarget', () => {
  it('defaults to the OpenAI endpoint', () => {
    expect(openaiRequestTarget()).toEqual({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      protocol: 'https',
    });
  });

  it('keeps the path prefix of an OpenAI-compatible base URL', () => {
    expect(openaiRequestTarget('https://freebuff.com/api/v1/paid')).toEqual({
      hostname: 'freebuff.com',
      path: '/api/v1/paid/chat/completions',
      protocol: 'https',
    });
  });

  it('tolerates a trailing slash', () => {
    expect(openaiRequestTarget('https://api.openai.com/v1/').path).toBe('/v1/chat/completions');
  });

  it('keeps a local port and plain http', () => {
    expect(openaiRequestTarget('http://localhost:1234/v1')).toEqual({
      hostname: 'localhost',
      path: '/v1/chat/completions',
      protocol: 'http',
      port: 1234,
    });
  });

  it('rejects an unparseable base URL', () => {
    expect(() => openaiRequestTarget('not a url')).toThrow('Invalid base URL');
  });
});

describe('parseOpenAICompletion', () => {
  it('reads text from a non-streamed reply', () => {
    const body = JSON.stringify({ choices: [{ message: { content: 'Tempo set.' } }] });
    expect(parseOpenAICompletion(body)).toEqual({ text: 'Tempo set.', toolCalls: [] });
  });

  it('reads tool calls with stringified arguments', () => {
    const body = JSON.stringify({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: 'call_1', function: { name: 'song_set_tempo', arguments: '{"value":100}' } },
            ],
          },
        },
      ],
    });

    expect(parseOpenAICompletion(body).toolCalls).toEqual([
      { id: 'call_1', name: 'song_set_tempo', args: { value: 100 } },
    ]);
  });

  it('surfaces an error body from the provider', () => {
    expect(() => parseOpenAICompletion('{"error":{"message":"Invalid API key"}}')).toThrow(
      'Invalid API key',
    );
  });

  it('throws on a body that is not JSON', () => {
    expect(() => parseOpenAICompletion('<html>502</html>')).toThrow('Unreadable response');
  });
});

describe('parseRetryDelay', () => {
  it('reads a Gemini-style retryDelay', () => {
    expect(parseRetryDelay('{"error":{"details":[{"retryDelay":"17s"}]}}')).toBe(17);
  });

  it('reads an OpenAI-style retry_after', () => {
    expect(parseRetryDelay('{"error":{"message":"slow down","retry_after":12}}')).toBe(12);
  });

  it('falls back to 60s when the body says nothing', () => {
    expect(parseRetryDelay('{"error":{"message":"Too many requests"}}')).toBe(60);
    expect(parseRetryDelay('')).toBe(60);
  });
});

describe('isPermanentQuotaError', () => {
  it('treats a per-minute "limit exceeded" as transient, not permanent', () => {
    // Freebuff answers this when a turn's rounds exceed 100k tokens/minute.
    expect(
      isPermanentQuotaError('{"error":{"message":"Paid API limit exceeded","code":"rate_limit"}}'),
    ).toBe(false);
  });

  it('flags balance and quota wording', () => {
    expect(isPermanentQuotaError('{"error":{"message":"Insufficient balance"}}')).toBe(true);
    expect(isPermanentQuotaError('{"error":{"message":"Monthly quota reached"}}')).toBe(true);
  });

  it('does not flag a transient throttle', () => {
    expect(isPermanentQuotaError('{"error":{"message":"upstream overloaded"}}')).toBe(false);
    expect(isPermanentQuotaError('{"error":{"type":"rate_limit_error"}}')).toBe(false);
    expect(isPermanentQuotaError('')).toBe(false);
  });
});

describe('freebuff provider', () => {
  it('sends traffic to the paid endpoint, not OpenAI', () => {
    expect(providerBaseUrl('freebuff')).toBe('https://freebuff.com/api/v1/paid');
  });

  it('leaves OpenAI on its own endpoint', () => {
    expect(providerBaseUrl('openai')).toBeUndefined();
  });

  it('streams only the model the catalog marks as streaming', () => {
    expect(modelStreams('freebuff', 'deepseek-v4.1-flash')).toBe(true);
    expect(modelStreams('freebuff', 'claude-haiku-5-5')).toBe(false);
  });

  it('defaults to streaming for models without a flag', () => {
    expect(modelStreams('ollama', 'gemma4:12b')).toBe(true);
    expect(modelStreams('unknown', 'whatever')).toBe(true);
  });

  it('defaults to the streaming, tool-capable model and requires a key', () => {
    expect(PROVIDERS.freebuff.default).toBe('deepseek-v4.1-flash');
    expect(PROVIDERS.freebuff.requiresKey).toBe(true);
  });
});
