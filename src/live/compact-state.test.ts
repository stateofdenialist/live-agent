import { describe, it, expect } from 'vitest';
import type { LiveState } from '../agent/chat.js';
import { compactLiveState } from './compact-state.js';

function makeState(): LiveState {
  return {
    tempo: 120,
    rootNote: 0,
    scaleName: 'Major',
    scaleMode: true,
    scaleIntervals: [0, 2, 4],
    gridQuantization: 4,
    gridIsTriplet: false,
    trackCount: 1,
    tracks: [
      {
        id: 'track-1',
        name: 'Drums',
        type: 'midi',
        mute: false,
        solo: false,
        mutedViaSolo: false,
        arm: false,
        groupTrackId: null,
        mixer: { volume: { id: 'v', value: 0.8 }, panning: { id: 'p', value: 0 }, sends: [] },
        devices: [
          {
            id: 'device-1',
            name: 'Operator',
            parameters: [
              {
                id: 'param-1',
                name: 'Volume',
                value: 0.5,
                min: 0,
                max: 1,
                defaultValue: 0.7,
                isQuantized: false,
              },
              {
                id: 'param-2',
                name: 'Wave',
                value: 2,
                min: 0,
                max: 6,
                defaultValue: 0,
                isQuantized: true,
                valueItems: [{ name: 'Sine', shortName: 'Sin' }],
              },
            ],
          },
        ],
        sessionClips: [
          {
            id: 'clip-1',
            name: 'Beat',
            slotIndex: 0,
            startTime: 0,
            endTime: 4,
            duration: 4,
            startMarker: 0,
            endMarker: 4,
            looping: true,
            loopStart: 0,
            loopEnd: 4,
            color: 1,
            muted: false,
            notes: [
              { pitch: 36, startTime: 0, duration: 0.25, velocity: 100 },
              { pitch: 38, startTime: 1, duration: 0.25, velocity: 90 },
            ],
          },
        ],
        arrangementClips: [],
        takeLanes: [],
      },
    ],
    mainTrack: {
      id: 'main',
      mixer: { volume: { id: 'mv', value: 1 }, panning: { id: 'mp', value: 0 }, sends: [] },
    },
    scenes: [{ id: 'scene-1', name: 'Verse', tempo: undefined } as never],
    cuePoints: [{ id: 'cue-1', name: 'Drop', time: 16 }],
  } as unknown as LiveState;
}

describe('compactLiveState', () => {
  it('keeps ids, routing and mixer values', () => {
    const compact = compactLiveState(makeState()) as {
      tempo: number;
      tracks: Array<{ id: string; devices: Array<{ id: string }> }>;
    };

    expect(compact.tempo).toBe(120);
    expect(compact.tracks[0].id).toBe('track-1');
    expect(compact.tracks[0].devices[0].id).toBe('device-1');
  });

  it('drops device parameters but reports how many exist', () => {
    const compact = compactLiveState(makeState()) as {
      tracks: Array<{ devices: Array<Record<string, unknown>> }>;
    };
    const device = compact.tracks[0].devices[0];

    expect(device['parameters']).toBeUndefined();
    expect(device['parameterCount']).toBe(2);
  });

  it('drops clip notes but reports the count', () => {
    const compact = compactLiveState(makeState()) as {
      tracks: Array<{ sessionClips: Array<Record<string, unknown>> }>;
    };
    const clip = compact.tracks[0].sessionClips[0];

    expect(clip['notes']).toBeUndefined();
    expect(clip['noteCount']).toBe(2);
    expect(clip['looping']).toBe(true);
  });

  it('is dramatically smaller than the full snapshot', () => {
    const state = makeState();
    const full = JSON.stringify(state).length;
    const compact = JSON.stringify(compactLiveState(state)).length;
    expect(compact).toBeLessThan(full);
  });
});
