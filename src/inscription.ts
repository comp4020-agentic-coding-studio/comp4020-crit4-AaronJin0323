// The one line of prose on the page, written from whatever is actually
// sounding.
//
// It is a description, never a score: no combination is called better than
// another, nothing is unlocked, and there is no line the player is being
// steered toward. It exists because a screen-reader user needs some channel
// for "Zeus is sounding" once the buttons stop pretending to be toggles ---
// and because a player who stumbles into the storm deserves to be told what
// they found.

import type { GodId } from "./gods.ts";

const ALONE: Record<GodId, string> = {
  zeus: "Zeus commands the sky.",
  poseidon: "Poseidon stirs the deep.",
  hades: "Hades opens the lower dark.",
  demeter: "Demeter sets something growing.",
  apollo: "Apollo strikes the lyre.",
  artemis: "Artemis looses her arrows.",
  ares: "Ares beats on his shield.",
};

const NAMES: Record<GodId, string> = {
  zeus: "Zeus",
  poseidon: "Poseidon",
  hades: "Hades",
  demeter: "Demeter",
  apollo: "Apollo",
  artemis: "Artemis",
  ares: "Ares",
};

/** "Zeus", "Zeus and Ares", "Zeus, Demeter and Ares". */
function list(ids: GodId[]): string {
  const names = ids.map((id) => NAMES[id]);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function describe(active: GodId[], hasPlayed: boolean): string {
  if (active.length === 0) {
    return hasPlayed ? "The echoes return to Olympus." : "The pantheon sleeps.";
  }
  if (active.length === 1) return ALONE[active[0]];

  const on = (id: GodId): boolean => active.includes(id);

  // Named relationships first, because they are what the player just heard
  // change. Order is fixed rather than ranked --- the world's three realms
  // are simply the largest claim on the page.
  if (on("zeus") && on("poseidon") && on("hades")) {
    return "Sky, sea and underworld divide the world between them.";
  }
  if (on("zeus") && on("poseidon")) return "Thunder rolls across Poseidon's sea.";
  if (on("apollo") && on("artemis")) return "Apollo and Artemis answer one another.";
  if (on("hades") && on("demeter")) return "Demeter's green pushes up through Hades' dark.";
  if (on("ares")) {
    const rest = active.filter((id) => id !== "ares");
    return `Ares beats time for ${list(rest)}.`;
  }
  return `${list(active)} are awake.`;
}
