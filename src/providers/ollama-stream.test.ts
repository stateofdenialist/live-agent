import { describe, it, expect } from 'vitest';
import {
  buildOllamaMessages,
  parseOllamaStream,
  resolveOllamaNumCtx,
  type HttpChunk,
} from './http-stream.js';

async function* lines(...parts: string[]): AsyncGenerator<string> {
  for (const part of parts) yield part;
}

async function collect(stream: AsyncIterable<HttpChunk>): Promise<HttpChunk[]> {
  const chunks: HttpChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe('parseOllamaStream', () => {
  it('yields text deltas', async () => {
    const chunks = await collect(
      parseOllamaStream(
        lines(
          JSON.stringify({ message: { content: 'Tempo' }, done: false }),
          JSON.stringify({ message: { content: ' set.' }, done: true }),
        ),
      ),
    );

    expect(chunks).toEqual([
      { type: 'text', text: 'Tempo' },
      { type: 'text', text: ' set.' },
    ]);
  });

  it('yields a tool call with object arguments', async () => {
    const chunks = await collect(
      parseOllamaStream(
        lines(
          JSON.stringify({
            message: {
              tool_calls: [{ function: { name: 'song_set_tempo', arguments: { value: 70 } } }],
            },
            done: true,
          }),
        ),
      ),
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      type: 'tool_call',
      name: 'song_set_tempo',
      args: { value: 70 },
    });
    expect((chunks[0] as { id: string }).id).toBeTruthy();
  });

  it('parses stringified arguments', async () => {
    const chunks = await collect(
      parseOllamaStream(
        lines(
          JSON.stringify({
            message: {
              tool_calls: [{ function: { name: 'song_set_tempo', arguments: '{"value":128}' } }],
            },
          }),
        ),
      ),
    );

    expect(chunks[0]).toMatchObject({ type: 'tool_call', args: { value: 128 } });
  });

  it('skips malformed lines and empty tool calls', async () => {
    const chunks = await collect(
      parseOllamaStream(lines('not json', '', JSON.stringify({ message: { tool_calls: [{}] } }))),
    );

    expect(chunks).toEqual([]);
  });

  it('throws on an error frame', async () => {
    await expect(
      collect(parseOllamaStream(lines(JSON.stringify({ error: 'model not found' })))),
    ).rejects.toThrow('model not found');
  });
});

describe('resolveOllamaNumCtx', () => {
  it('defaults to 32768 when unset', () => {
    expect(resolveOllamaNumCtx(undefined)).toBe(32768);
    expect(resolveOllamaNumCtx('')).toBe(32768);
  });

  it('accepts a positive override', () => {
    expect(resolveOllamaNumCtx('8192')).toBe(8192);
    expect(resolveOllamaNumCtx(' 65536 ')).toBe(65536);
  });

  it('falls back for invalid or non-positive values', () => {
    expect(resolveOllamaNumCtx('lots')).toBe(32768);
    expect(resolveOllamaNumCtx('0')).toBe(32768);
    expect(resolveOllamaNumCtx('-4096')).toBe(32768);
  });
});

describe('buildOllamaMessages', () => {
  it('prefixes the system prompt and maps history to native roles', () => {
    const messages = buildOllamaMessages('You control Live.', [
      { role: 'user', content: 'Set tempo to 70.' },
      {
        role: 'assistant',
        content: '',
        toolCall: { id: 'c1', name: 'song_set_tempo', args: { value: 70 } },
      },
      { role: 'tool', content: '{"ok":true}', toolCallId: 'c1', toolName: 'song_set_tempo' },
    ]);

    expect(messages[0]).toEqual({ role: 'system', content: 'You control Live.' });
    expect(messages[1]).toEqual({ role: 'user', content: 'Set tempo to 70.' });
    expect(messages[2]).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [{ function: { name: 'song_set_tempo', arguments: { value: 70 } } }],
    });
    expect(messages[3]).toEqual({
      role: 'tool',
      content: '{"ok":true}',
      tool_name: 'song_set_tempo',
    });
  });
});
