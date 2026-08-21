// Who is awake, and what that does to everyone else.
//
// Two jobs. First, reference counting: a god can be held by a finger and a key
// at the same time, and the second hold must not start a second voice nor the
// first release stop it. Second, relationships: gods are told about each other
// from here, so gods.ts never has to reach sideways.

import { getAudio } from "./engine.ts";
import type { GodId, Gesture, GodVoice, Relation } from "./gods.ts";
import { FACTORIES, GOD_IDS } from "./gods.ts";

const voices = new Map<GodId, GodVoice>();
/** Who is currently holding each god: "pointer-3", "key-a", "focus". */
const holders = new Map<GodId, Set<string>>();

type ChangeListener = (awake: GodId[]) => void;
const changeListeners = new Set<ChangeListener>();

export function onChange(listener: ChangeListener): void {
  changeListeners.add(listener);
}

export function awake(): GodId[] {
  return GOD_IDS.filter((id) => voices.has(id));
}

export function isAwake(id: GodId): boolean {
  return voices.has(id);
}

function announce(): void {
  const list = awake();
  for (const listener of changeListeners) listener(list);
}

function relate(id: GodId, relation: Relation, amount: number): void {
  voices.get(id)?.setRelation(relation, amount);
}

/**
 * Four relationships plus the spatial one. Recomputed from scratch whenever
 * the active set changes --- cheap, and it means a relation can never be left
 * switched on by a god who has since gone quiet.
 *
 * None of these is a secret or a reward. They are just what these forces do
 * when they are in the same room.
 */
function applyRelationships(): void {
  const on = (id: GodId): boolean => voices.has(id);

  // Sky over sea: the storm.
  const storm = on("zeus") && on("poseidon") ? 1 : 0;
  relate("zeus", "storm", storm);
  relate("poseidon", "storm", storm);

  // Sun and moon: one plays, the other answers between.
  const answer = on("apollo") && on("artemis") ? 1 : 0;
  relate("apollo", "answer", answer);
  relate("artemis", "answer", answer);

  // Decay and growth: he rises a little, she slows down.
  const cycle = on("hades") && on("demeter") ? 1 : 0;
  relate("hades", "cycle", cycle);
  relate("demeter", "cycle", cycle);

  // War keeps time for whoever else is here, and steps back as the room fills.
  const others = awake().filter((id) => id !== "ares").length;
  relate("ares", "march", others);

  // All three realms at once: they take separate registers so the world
  // divides into sky, surface and underworld.
  const axis = on("zeus") && on("poseidon") && on("hades") ? 1 : 0;
  relate("zeus", "axis", axis);
  relate("poseidon", "axis", axis);
  relate("hades", "axis", axis);
}

export function invoke(id: GodId, holder: string, gesture: Gesture): void {
  let held = holders.get(id);
  if (!held) {
    held = new Set();
    holders.set(id, held);
  }
  const first = held.size === 0;
  held.add(holder);
  if (!first) {
    // Already sounding --- the new hold just steers it.
    voices.get(id)?.update(gesture);
    return;
  }

  // getAudio() both creates the context and resumes it, so the gesture that
  // wakes the browser's audio is the same gesture that makes this sound.
  voices.set(id, FACTORIES[id](getAudio(), gesture));
  applyRelationships();
  announce();
}

export function release(id: GodId, holder: string): void {
  const held = holders.get(id);
  if (!held || !held.delete(holder) || held.size > 0) return;

  const voice = voices.get(id);
  voices.delete(id);
  voice?.release();
  applyRelationships();
  announce();
}

/** Everything off: window blur, tab hidden, pointer cancelled mid-drag. */
export function releaseAll(): void {
  if (voices.size === 0) return;
  for (const [, voice] of voices) voice.release();
  voices.clear();
  holders.clear();
  announce();
}

export function steer(id: GodId, gesture: Gesture): void {
  voices.get(id)?.update(gesture);
}
