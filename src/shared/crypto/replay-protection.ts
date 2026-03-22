/**
 * Replay Protection — prevents message replay and reordering attacks.
 *
 * Tracks (senderDeviceId, epoch, messageSequence) tuples and rejects
 * duplicates or sequences outside the acceptance window.
 *
 * Window strategy: sliding window of WINDOW_SIZE around the highest
 * seen sequence. Messages below (highestSeen - WINDOW_SIZE) are
 * unconditionally rejected. The floor uses strict less-than so the
 * boundary message itself is still accepted.
 *
 * Persistence: the highest-seen sequence per key is persisted via an
 * injectable storage backend so the window floor survives app restarts.
 * The full `seen` set is NOT persisted — on restart, only the floor is
 * restored, which means a message replayed between restart and the next
 * legitimate message at or above that floor could sneak through. This is
 * an acceptable trade-off: persisting the full bitfield would be complex
 * and the window is small.
 */

const WINDOW_SIZE = 2048;

interface ChannelState {
  highestSequence: number;
  seen: Set<number>;
}

/**
 * Storage backend for persisting replay window floors.
 * Implementations should use Electron safeStorage, IndexedDB, or similar.
 */
export interface ReplayStorageBackend {
  load(key: string): number | null;
  save(key: string, highestSequence: number): void;
  remove(key: string): void;
  clear(): void;
}

/** Per-conversation replay state. Key format: "conversationId:epoch:senderDeviceId" */
const replayState = new Map<string, ChannelState>();

let storageBackend: ReplayStorageBackend | null = null;

/**
 * Set the persistence backend for replay state.
 * Must be called once during app initialization.
 */
export function setReplayStorageBackend(backend: ReplayStorageBackend): void {
  storageBackend = backend;
}

function stateKey(conversationId: string, epoch: number, senderDeviceId: string): string {
  return `${conversationId}:${epoch}:${senderDeviceId}`;
}

/**
 * Check if a message should be accepted (not a replay).
 *
 * @param conversationId  Channel or DM conversation ID
 * @param epoch           Epoch number
 * @param senderDeviceId  Sender's device ID
 * @param messageSequence Server-assigned monotonic sequence
 * @returns true if the message is accepted, false if rejected (replay/out-of-window)
 */
export function acceptMessage(
  conversationId: string,
  epoch: number,
  senderDeviceId: string,
  messageSequence: number
): boolean {
  const key = stateKey(conversationId, epoch, senderDeviceId);
  let state = replayState.get(key);

  if (!state) {
    // Restore persisted floor on first access after restart
    const persisted = storageBackend?.load(key) ?? null;
    state = { highestSequence: persisted ?? -1, seen: new Set() };
    replayState.set(key, state);
  }

  // Reject if already seen in this session
  if (state.seen.has(messageSequence)) {
    return false;
  }

  // Reject if below the sliding window floor (strict less-than so
  // the message at the floor boundary is still accepted)
  const floor = state.highestSequence - WINDOW_SIZE;
  if (messageSequence < floor) {
    return false;
  }

  // Accept and record
  state.seen.add(messageSequence);

  // Update highest seen and persist
  if (messageSequence > state.highestSequence) {
    state.highestSequence = messageSequence;
    storageBackend?.save(key, state.highestSequence);

    // Prune entries below the new floor.
    // ES spec guarantees Set deletion during iteration is safe.
    const newFloor = state.highestSequence - WINDOW_SIZE;
    if (newFloor > 0) {
      for (const seq of state.seen) {
        if (seq < newFloor) {
          state.seen.delete(seq);
        }
      }
    }
  }

  return true;
}

/** Clear replay state for a conversation epoch (e.g. on epoch rotation). */
export function clearReplayState(conversationId: string, epoch: number): void {
  for (const key of Array.from(replayState.keys())) {
    if (key.startsWith(`${conversationId}:${epoch}:`)) {
      replayState.delete(key);
      storageBackend?.remove(key);
    }
  }
}

/** Clear all replay state (e.g. on logout). */
export function clearAllReplayState(): void {
  replayState.clear();
  storageBackend?.clear();
}
