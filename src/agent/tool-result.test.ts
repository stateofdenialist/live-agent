import { describe, it, expect } from 'vitest';
import { MAX_TOOL_RESULT_CHARS, truncateToolResult } from './tool-result.js';

describe('truncateToolResult', () => {
  it('leaves a small result untouched', () => {
    const small = '{"ok":true}';
    expect(truncateToolResult(small)).toBe(small);
  });

  it('leaves a result exactly at the limit untouched', () => {
    const atLimit = 'x'.repeat(MAX_TOOL_RESULT_CHARS);
    expect(truncateToolResult(atLimit)).toBe(atLimit);
  });

  it('caps an oversized result and keeps the head readable', () => {
    const huge = JSON.stringify({ tracks: Array(5000).fill({ name: 'Track', id: '9' }) });
    expect(huge.length).toBeGreaterThan(MAX_TOOL_RESULT_CHARS);

    const capped = truncateToolResult(huge, 1000);
    const parsed = JSON.parse(capped) as {
      truncated: boolean;
      original_chars: number;
      included_chars: number;
      note: string;
      head: string;
    };

    expect(parsed.truncated).toBe(true);
    expect(parsed.original_chars).toBe(huge.length);
    expect(parsed.included_chars).toBe(1000);
    expect(parsed.head).toHaveLength(1000);
    expect(parsed.head).toBe(huge.slice(0, 1000));
    expect(parsed.note).toContain('narrower slice');
  });

  it('stays valid JSON so providers accept it as tool content', () => {
    const capped = truncateToolResult('{'.repeat(50_000), 500);
    expect(() => JSON.parse(capped)).not.toThrow();
  });
});
