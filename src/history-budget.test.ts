import { describe, it, expect } from 'vitest';
import {
  pruneHistoryForProvider,
  HISTORY_CHAR_BUDGET,
  HISTORY_PRUNE_STUB,
} from './history-prune.js';
import type { ProviderMessage } from './providers/index.js';

/** Builds a user turn followed by `count` assistant+tool pairs with fat results. */
function historyWithToolResults(count: number, resultSize: number): ProviderMessage[] {
  const history: ProviderMessage[] = [{ role: 'user', content: 'make a beat' }];
  for (let i = 0; i < count; i++) {
    history.push({
      role: 'assistant',
      content: '',
      toolCall: { id: `call-${i}`, name: 'get_live_state', args: {} },
    });
    history.push({
      role: 'tool',
      toolCallId: `call-${i}`,
      toolName: 'get_live_state',
      content: 'x'.repeat(resultSize),
    });
  }
  return history;
}

function totalChars(messages: ProviderMessage[]): number {
  return messages.reduce((sum, message) => sum + message.content.length, 0);
}

describe('history character budget', () => {
  it('leaves a history under the budget untouched', () => {
    const history = historyWithToolResults(3, 100);
    expect(pruneHistoryForProvider(history)).toEqual(history);
  });

  it('stubs old tool results and keeps the newest ones whole', () => {
    const history = historyWithToolResults(12, 10_000);
    const pruned = pruneHistoryForProvider(history);
    const toolMessages = pruned.filter((message) => message.role === 'tool');

    expect(totalChars(history)).toBeGreaterThan(HISTORY_CHAR_BUDGET);
    expect(totalChars(pruned)).toBeLessThan(40_000);

    // Newest result is intact, oldest is stubbed.
    expect(toolMessages.at(-1)?.content).toBe('x'.repeat(10_000));
    expect(toolMessages[0]?.content).toBe(HISTORY_PRUNE_STUB);
  });

  it('keeps tool-call ids paired with their results', () => {
    const history = historyWithToolResults(12, 10_000);
    const pruned = pruneHistoryForProvider(history);

    const callIds = pruned
      .filter((message) => message.role === 'assistant' && message.toolCall)
      .map((message) => message.toolCall?.id);
    const resultIds = pruned
      .filter((message) => message.role === 'tool')
      .map((message) => message.toolCallId);

    expect(resultIds).toEqual(callIds);
  });

  it('keeps user messages even when the budget is blown', () => {
    const history = historyWithToolResults(12, 10_000);
    expect(pruneHistoryForProvider(history)).toContainEqual({
      role: 'user',
      content: 'make a beat',
    });
  });
});
