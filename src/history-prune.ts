import type { ProviderMessage } from './providers/index.js';

/** History length above which oldest tool pairs are dropped before each provider call. */
export const HISTORY_PRUNE_THRESHOLD = 40;

/**
 * Character budget (~8k tokens) for the messages sent to a provider.
 *
 * The agent re-sends the whole history on every round, and one tool result can
 * be hundreds of kilobytes, so message count alone is a poor guard: a handful of
 * fat results will blow a provider's per-minute token budget mid-turn. Once the
 * budget is exceeded, older tool results are replaced by {@link HISTORY_PRUNE_STUB};
 * the newest ones stay intact because they are what the model is working with.
 */
export const HISTORY_CHAR_BUDGET = 32_000;

/** Synthetic assistant note inserted once when tool-call history is trimmed. */
export const HISTORY_PRUNE_OMIT_MESSAGE =
  '[Earlier tool calls omitted to save context. Call get_live_state to refresh session state.]';

/** Replacement content for a tool result dropped by the character budget. */
export const HISTORY_PRUNE_STUB =
  '{"omitted":true,"note":"Older tool result dropped to save context. Call the tool again if you need this data."}';

/**
 * Returns a copy of `history` trimmed for a provider call: oldest assistant+tool
 * pairs are dropped when the message count is too high, then older tool results
 * are stubbed so the payload fits {@link HISTORY_CHAR_BUDGET}. All user messages
 * are kept.
 */
export function pruneHistoryForProvider(history: ProviderMessage[]): ProviderMessage[] {
  return enforceCharBudget(dropOldestToolPairs(history));
}

/** Drops the oldest assistant+tool pairs while the history is over the count limit. */
function dropOldestToolPairs(history: ProviderMessage[]): ProviderMessage[] {
  if (history.length <= HISTORY_PRUNE_THRESHOLD) {
    return history;
  }

  const working = [...history];
  let pruned = false;
  let firstPrunedIndex: number | undefined;

  while (working.length > HISTORY_PRUNE_THRESHOLD) {
    const pairIndex = findOldestToolPairIndex(working);
    if (pairIndex === -1) {
      break;
    }
    if (firstPrunedIndex === undefined) {
      firstPrunedIndex = pairIndex;
    }
    working.splice(pairIndex, 2);
    pruned = true;
  }

  if (!pruned || firstPrunedIndex === undefined) {
    return working;
  }

  working.splice(firstPrunedIndex, 0, {
    role: 'assistant',
    content: HISTORY_PRUNE_OMIT_MESSAGE,
  });

  return working;
}

/** Replaces old tool results with a stub until the payload fits the budget. */
function enforceCharBudget(messages: ProviderMessage[]): ProviderMessage[] {
  if (totalChars(messages) <= HISTORY_CHAR_BUDGET) {
    return messages;
  }

  const result = [...messages];
  let total = 0;

  // Walk backwards so the newest — and most relevant — results are kept whole.
  for (let i = result.length - 1; i >= 0; i--) {
    const message = result[i];
    const size = messageSize(message);

    if (total + size <= HISTORY_CHAR_BUDGET) {
      total += size;
      continue;
    }

    if (message.role === 'tool' && message.content !== HISTORY_PRUNE_STUB) {
      result[i] = Object.assign({}, message, { content: HISTORY_PRUNE_STUB }) as ProviderMessage;
      total += HISTORY_PRUNE_STUB.length;
    } else {
      total += size;
    }
  }

  return result;
}

/** Approximate payload size of one message, including tool-call arguments. */
function messageSize(message: ProviderMessage): number {
  const args = message.toolCall ? JSON.stringify(message.toolCall.args).length : 0;
  return message.content.length + args;
}

function totalChars(messages: ProviderMessage[]): number {
  return messages.reduce((sum, message) => sum + messageSize(message), 0);
}

/**
 * Finds the index of the oldest consecutive assistant (with tool call) + tool pair.
 * Returns -1 when no removable pair exists.
 */
function findOldestToolPairIndex(messages: ProviderMessage[]): number {
  for (let i = 0; i < messages.length - 1; i++) {
    const current = messages[i];
    const next = messages[i + 1];
    if (
      current?.role === 'assistant' &&
      current.toolCall !== undefined &&
      next?.role === 'tool' &&
      next.toolCallId === current.toolCall.id
    ) {
      return i;
    }
  }
  return -1;
}
