import type { ClipInfo, DeviceInfo, LiveState } from '../agent/chat.js';

/**
 * Reduces a full session snapshot to what the model needs in order to act:
 * ids, names, routing and mixer values.
 *
 * A real 8-track session serialised to 361 KB (~90k tokens) because every
 * device carried all of its parameters, with ranges, defaults and quantised
 * value lists. That single tool result outweighed the entire conversation and
 * tripped provider token limits on the next round, so the tool returns this
 * compact form by default. Device parameters and clip notes remain reachable:
 * `get_live_state` accepts `detail: "full"`, and the device/clip tools read them
 * on demand.
 */
export function compactLiveState(state: LiveState): Record<string, unknown> {
  return {
    tempo: state.tempo,
    rootNote: state.rootNote,
    scaleName: state.scaleName,
    scaleMode: state.scaleMode,
    scaleIntervals: state.scaleIntervals,
    gridQuantization: state.gridQuantization,
    gridIsTriplet: state.gridIsTriplet,
    trackCount: state.trackCount,
    tracks: state.tracks.map((track) => ({
      id: track.id,
      name: track.name,
      type: track.type,
      mute: track.mute,
      solo: track.solo,
      mutedViaSolo: track.mutedViaSolo,
      arm: track.arm,
      groupTrackId: track.groupTrackId,
      mixer: track.mixer,
      devices: compactDevices(track.devices),
      sessionClips: compactClips(track.sessionClips),
      arrangementClips: compactClips(track.arrangementClips),
      takeLanes: track.takeLanes.map((lane) => ({
        id: lane.id,
        name: lane.name,
        clips: lane.clips.map((clip) => clip.name),
      })),
    })),
    mainTrack: state.mainTrack,
    scenes: state.scenes,
    cuePoints: state.cuePoints,
  };
}

/** Devices keep identity and nesting; `parameterCount` hints at what a detail call would add. */
function compactDevices(devices: DeviceInfo[]): Array<Record<string, unknown>> {
  return devices.map((device) => ({
    id: device.id,
    name: device.name,
    ...(device.samplePath ? { samplePath: device.samplePath } : {}),
    parameterCount: device.parameters.length,
    ...(device.chains
      ? {
          chains: device.chains.map((chain) => ({
            id: chain.id,
            name: chain.name,
            ...(chain.receivingNote !== undefined ? { receivingNote: chain.receivingNote } : {}),
            devices: compactDevices(chain.devices),
          })),
        }
      : {}),
  }));
}

/** Clips keep placement and length; note lists and warp markers are omitted. */
function compactClips(clips: ClipInfo[]): Array<Record<string, unknown>> {
  return clips.map((clip) => ({
    id: clip.id,
    name: clip.name,
    slotIndex: clip.slotIndex,
    startTime: clip.startTime,
    endTime: clip.endTime,
    duration: clip.duration,
    looping: clip.looping,
    muted: clip.muted,
    ...(clip.notes ? { noteCount: clip.notes.length } : {}),
  }));
}
