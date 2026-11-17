import { describe, it, expect } from 'vitest';
import { createWedgeDetector, WEDGE_LINE } from './host-health.js';

/** Detector with a controllable clock: threshold 3 lines inside 1000ms. */
function makeDetector(): {
  detector: ReturnType<typeof createWedgeDetector>;
  advance: (ms: number) => void;
} {
  let now = 0;
  const detector = createWedgeDetector({ threshold: 3, windowMs: 1000, now: () => now });
  return {
    detector,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('createWedgeDetector', () => {
  it('ignores lines unrelated to the bridge', () => {
    const { detector } = makeDetector();
    expect(detector.push('[Live Agent] Ready — 8 tracks loaded')).toBe(false);
  });

  it('reports a burst of bridge failures', () => {
    const { detector } = makeDetector();
    expect(detector.push(WEDGE_LINE)).toBe(false);
    expect(detector.push(WEDGE_LINE)).toBe(false);
    expect(detector.push(WEDGE_LINE)).toBe(true);
  });

  it('does not report when failures are spread beyond the window', () => {
    const { detector, advance } = makeDetector();
    for (let i = 0; i < 10; i++) {
      expect(detector.push(WEDGE_LINE)).toBe(false);
      // Each failure is older than the window by the time the next one lands.
      advance(1500);
    }
  });

  it('reports once per burst, not on every following line', () => {
    const { detector } = makeDetector();
    detector.push(WEDGE_LINE);
    detector.push(WEDGE_LINE);
    expect(detector.push(WEDGE_LINE)).toBe(true);
    expect(detector.push(WEDGE_LINE)).toBe(false);
    expect(detector.push(WEDGE_LINE)).toBe(false);
  });

  it('can report a second, separate burst', () => {
    const { detector } = makeDetector();
    detector.push(WEDGE_LINE);
    detector.push(WEDGE_LINE);
    expect(detector.push(WEDGE_LINE)).toBe(true);

    detector.push(WEDGE_LINE);
    detector.push(WEDGE_LINE);
    expect(detector.push(WEDGE_LINE)).toBe(true);
  });

  it('forgets earlier lines after reset', () => {
    const { detector } = makeDetector();
    detector.push(WEDGE_LINE);
    detector.push(WEDGE_LINE);
    detector.reset();
    expect(detector.push(WEDGE_LINE)).toBe(false);
    expect(detector.push(WEDGE_LINE)).toBe(false);
    expect(detector.push(WEDGE_LINE)).toBe(true);
  });
});
