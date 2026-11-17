/**
 * Caps how much of a single tool result reaches the model.
 *
 * Some getters return thousands of records (every device parameter of every
 * track, full note lists, full arrangement). One such result can be larger than
 * the whole conversation and blow a provider's per-request or per-minute token
 * budget, which surfaces as a confusing rate-limit error on the next round.
 * The UI still receives the full result; only the model-facing copy is capped.
 */
export const MAX_TOOL_RESULT_CHARS = 24_000;

/**
 * Returns `content` unchanged when it fits, otherwise a compact JSON envelope
 * with the first `limit` characters and a note telling the model to query less.
 */
export function truncateToolResult(content: string, limit = MAX_TOOL_RESULT_CHARS): string {
  if (content.length <= limit) return content;

  return JSON.stringify({
    truncated: true,
    original_chars: content.length,
    included_chars: limit,
    note:
      `The result was ${content.length} characters, so only the first ${limit} are included. ` +
      'Ask for a narrower slice (one track, one clip, one device) instead of the whole session.',
    head: content.slice(0, limit),
  });
}
