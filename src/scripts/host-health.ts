/**
 * Detects Live's extension bridge wedging mid-session.
 *
 * When Live stops processing messages from the extension host it logs
 * "Failed to process receive queue, closing connection" in a tight loop and
 * silently drops the extension from its context menus. The host process itself
 * stays alive and healthy, so nothing in the dev runner notices. The runner
 * feeds host output through this detector and restarts the host when a burst
 * appears; if a freshly started host wedges too, the problem is on Live's side
 * and only toggling Developer Mode helps.
 */

/** Live's own log line when it fails to process a message from the host. */
export const WEDGE_LINE = 'Failed to process receive queue';

/** Wedge lines inside the window that count as a wedge rather than a blip. */
export const WEDGE_BURST_THRESHOLD = 6;

/** Sliding window used to recognise a burst. */
export const WEDGE_WINDOW_MS = 10_000;

export interface WedgeDetectorOptions {
  /** Wedge lines required to report a wedge (default {@link WEDGE_BURST_THRESHOLD}). */
  threshold?: number;
  /** Sliding window in milliseconds (default {@link WEDGE_WINDOW_MS}). */
  windowMs?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

export interface WedgeDetector {
  /** Feeds one output line; returns true once per burst. */
  push(line: string): boolean;
  /** Clears recorded lines, e.g. after the host is restarted. */
  reset(): void;
}

/** Creates a detector that reports a wedge once per burst of {@link WEDGE_LINE}. */
export function createWedgeDetector(options: WedgeDetectorOptions = {}): WedgeDetector {
  const threshold = options.threshold ?? WEDGE_BURST_THRESHOLD;
  const windowMs = options.windowMs ?? WEDGE_WINDOW_MS;
  const now = options.now ?? Date.now;
  let hits: number[] = [];

  return {
    push(line: string): boolean {
      if (!line.includes(WEDGE_LINE)) return false;

      const at = now();
      hits.push(at);
      hits = hits.filter((time) => at - time <= windowMs);
      if (hits.length < threshold) return false;

      // One report per burst. Clearing makes a second burst possible without
      // firing again on every remaining line of this one.
      hits = [];
      return true;
    },

    reset(): void {
      hits = [];
    },
  };
}
