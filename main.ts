// Hands and eyes. Everything that hears is under src/.
//
// One interaction, three ways in: pointer, touch, keyboard. Press to summon,
// hold to sustain, move to shape, drag to layer, let go to let it decay.
// There is nothing to configure --- the only non-playing control on the page
// is mute, which is a safety valve rather than a parameter.

import { clamp01, FULL_LEVEL, idle, setLevel } from "./src/engine.ts";
import type { Gesture, GodId } from "./src/gods.ts";
import { GOD_IDS } from "./src/gods.ts";
import { describe } from "./src/inscription.ts";
import { awake, invoke, isAwake, onChange, release, releaseAll, steer } from "./src/pantheon.ts";

const root = document.documentElement;
const totems = [...document.querySelectorAll<HTMLButtonElement>(".totem")];
const byGod = new Map<GodId, HTMLButtonElement>();
const byKey = new Map<string, HTMLButtonElement>();

for (const totem of totems) {
  const id = totem.dataset.god as GodId;
  byGod.set(id, totem);
  const key = totem.dataset.key;
  if (key) byKey.set(key, totem);
}

const godOf = (totem: HTMLButtonElement): GodId => totem.dataset.god as GodId;

// --- Gesture -----------------------------------------------------------
// Position is read against the viewport, not the button, so that dragging
// from one god to another is one continuous shaping movement rather than
// seven separate little coordinate systems.
//
//   y  bottom -> top    darker/lower -> brighter/higher
//   x  left -> right    stereo placement
//   speed               how hard, how rough, how sharp the attack

interface Track {
  gesture: Gesture;
  gods: Set<GodId>;
  lastX: number;
  lastY: number;
  lastTime: number;
  /** Where the last hit test happened, so we don't run one per pixel. */
  hitX: number;
  hitY: number;
}

const tracks = new Map<number, Track>();
/** How fast the pointer was travelling on the way in. */
let approach = 0;

/** Fast is about two screen pixels per millisecond. */
function sampleSpeed(dx: number, dy: number, dt: number): number {
  return clamp01(Math.hypot(dx, dy) / Math.max(dt, 8) / 2);
}

/**
 * Pen and force-sensitive panels report real pressure. Mice and most
 * touchscreens hard-code 0.5, which carries no information at all --- so we
 * fall back to how fast the hand was already moving, with a floor so a
 * deliberate slow press is still audible.
 */
function strikeIntensity(event: PointerEvent): number {
  const pressure = event.pressure;
  if (event.pointerType === "pen" || (pressure > 0 && Math.abs(pressure - 0.5) > 0.01)) {
    return clamp01(pressure);
  }
  return clamp01(0.3 + approach * 0.7);
}

function positionX(clientX: number): number {
  return clamp01(clientX / Math.max(window.innerWidth, 1));
}

function positionY(clientY: number): number {
  return clamp01(1 - clientY / Math.max(window.innerHeight, 1));
}

// --- Visual state ------------------------------------------------------
// The gods write themselves onto :root as --g-<name>, 0-1. CSS does the rest.
//
// How long each god stays audible after release, counting the tail its voice
// schedules plus what the shared delay gives back. The glow decays to nothing
// over exactly that window, so the picture is lit for as long as you can hear
// the sound --- not a 150ms click flash, and not a stone still glowing four
// seconds after it went quiet.

const AUDIBLE_TAIL_SECONDS: Record<GodId, number> = {
  zeus: 1.8, // 0.6s fade, then the thunder roll in the delay
  poseidon: 1.3,
  hades: 3.6, // 2.6s fade plus the underworld echo
  demeter: 1.2,
  apollo: 1,
  artemis: 1.8, // short plucks, but the arrows keep flying
  ares: 0.5, // percussion; it is over when it is over
};

/** Exponential decay reaching the 0.01 cut-off at the end of the tail. */
const FALL_PER_SECOND = Object.fromEntries(
  GOD_IDS.map((id) => [id, Math.log(100) / AUDIBLE_TAIL_SECONDS[id]]),
) as Record<GodId, number>;

const glow = new Map<GodId, number>(GOD_IDS.map((id) => [id, 0]));
let heat = 0;
let frameHandle = 0;
let lastFrame = 0;
let lastSteer = 0;
let steerDirty = false;

function frame(now: number): void {
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;

  // Standing still, a flick shouldn't leave the sea rough forever.
  for (const track of tracks.values()) {
    if (track.gesture.speed > 0.004) {
      track.gesture.speed *= Math.max(0, 1 - dt * 2.2);
      steerDirty = true;
    }
  }

  // Audio automation runs at ~30Hz, not at the pointer's 120Hz --- seven
  // voices times a dozen params per move is how you make a filter crackle.
  if (steerDirty && now - lastSteer > 33) {
    lastSteer = now;
    steerDirty = false;
    for (const track of tracks.values()) {
      for (const id of track.gods) steer(id, track.gesture);
    }
  }

  const active = awake();
  const target = clamp01(active.length / 4);
  heat += (target - heat) * Math.min(dt * (target > heat ? 2.2 : 0.9), 1);
  if (heat < 0.002) heat = 0;
  root.style.setProperty("--heat", heat.toFixed(3));

  let lit = false;
  for (const id of GOD_IDS) {
    const current = glow.get(id) ?? 0;
    const on = isAwake(id);
    const rate = on ? 6 : FALL_PER_SECOND[id];
    const step = Math.min(dt * rate, 1);
    let next = on ? current + (1 - current) * step : current - current * step;
    if (next < 0.01) next = on ? next : 0;
    if (next !== current) {
      glow.set(id, next);
      root.style.setProperty(`--g-${id}`, next.toFixed(3));
    }
    if (next > 0) lit = true;
  }

  if (!lit && heat === 0 && tracks.size === 0) {
    frameHandle = 0; // nothing moving; stop burning frames
    return;
  }
  frameHandle = requestAnimationFrame(frame);
}

function startFrames(): void {
  if (frameHandle) return;
  lastFrame = performance.now();
  frameHandle = requestAnimationFrame(frame);
}

// --- Inscription -------------------------------------------------------

const inscription = document.querySelector<HTMLElement>("[data-start]");
let hasPlayed = false;
let inscriptionTimer = 0;

onChange((active) => {
  for (const id of GOD_IDS) {
    byGod.get(id)?.classList.toggle("is-awake", active.includes(id));
  }
  if (active.length > 0) hasPlayed = true;
  startFrames();

  // Debounced, or a four-god strum fires four screen-reader announcements in
  // half a second and the region becomes noise.
  if (inscriptionTimer) window.clearTimeout(inscriptionTimer);
  inscriptionTimer = window.setTimeout(() => {
    inscriptionTimer = 0;
    if (!inscription) return;
    const text = describe(awake(), hasPlayed);
    if (inscription.textContent !== text) inscription.textContent = text;
  }, 700);
});

// --- Pointer -----------------------------------------------------------

for (const totem of totems) {
  totem.addEventListener("pointerdown", (event) => {
    if (tracks.has(event.pointerId)) return;
    const id = godOf(totem);
    const track: Track = {
      gesture: {
        x: positionX(event.clientX),
        y: positionY(event.clientY),
        speed: strikeIntensity(event),
      },
      gods: new Set([id]),
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      hitX: event.clientX,
      hitY: event.clientY,
    };
    tracks.set(event.pointerId, track);
    invoke(id, `pointer-${event.pointerId}`, track.gesture);
    startFrames();
  });
}

window.addEventListener("pointermove", (event) => {
  const track = tracks.get(event.pointerId);

  if (!track) {
    // Still worth watching: this is what tells us how hard the next strike is.
    approach = approach * 0.85 + sampleSpeed(event.movementX, event.movementY, 16) * 0.15;
    return;
  }

  const measured = sampleSpeed(
    event.clientX - track.lastX,
    event.clientY - track.lastY,
    event.timeStamp - track.lastTime,
  );
  approach = Math.max(approach * 0.85, measured);
  track.lastX = event.clientX;
  track.lastY = event.clientY;
  track.lastTime = event.timeStamp;

  const gesture = track.gesture;
  gesture.x = positionX(event.clientX);
  gesture.y = positionY(event.clientY);
  // Rises instantly, falls slowly (the frame loop does the falling), so the
  // sea reacts to a flick and then settles rather than flickering.
  gesture.speed = Math.max(gesture.speed * 0.8, measured);
  steerDirty = true;

  // Dragging onto another god layers it in. The hit test is a layout read, so
  // it runs after a few pixels of movement rather than on every event.
  if (Math.abs(event.clientX - track.hitX) + Math.abs(event.clientY - track.hitY) < 6) return;
  track.hitX = event.clientX;
  track.hitY = event.clientY;
  const under = document.elementFromPoint(event.clientX, event.clientY);
  const totem = under?.closest<HTMLButtonElement>(".totem");
  if (!totem) return;
  const id = godOf(totem);
  if (track.gods.has(id)) return;
  track.gods.add(id);
  invoke(id, `pointer-${event.pointerId}`, gesture);
});

function endPointer(event: PointerEvent): void {
  const track = tracks.get(event.pointerId);
  if (!track) return;
  tracks.delete(event.pointerId);
  for (const id of track.gods) release(id, `pointer-${event.pointerId}`);
}

window.addEventListener("pointerup", endPointer);
window.addEventListener("pointercancel", endPointer);

// --- Keyboard ----------------------------------------------------------

/** Keys can't move, so they get a fixed, comfortable place in the field. */
function keyGesture(totem: HTMLButtonElement): Gesture {
  const index = Math.max(totems.indexOf(totem), 0);
  const span = Math.max(totems.length - 1, 1);
  return { x: index / span, y: 0.58, speed: 0.5 };
}

let focusHeld: GodId | undefined;

window.addEventListener("keydown", (event) => {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;

  // Enter and Space on a focused totem. Without this a keyboard user who
  // tabs to a stone and presses the obvious key gets silence.
  if (event.key === "Enter" || event.key === " ") {
    const totem = document.activeElement?.closest<HTMLButtonElement>(".totem");
    if (!totem || focusHeld) return;
    event.preventDefault(); // Space scrolls; both would synthesise a click
    focusHeld = godOf(totem);
    invoke(focusHeld, "focus", keyGesture(totem));
    startFrames();
    return;
  }

  const totem = byKey.get(event.key.toLowerCase());
  if (!totem) return;
  invoke(godOf(totem), `key-${event.key.toLowerCase()}`, keyGesture(totem));
  startFrames();
});

window.addEventListener("keyup", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    if (!focusHeld) return;
    // Remembered from keydown rather than re-read from activeElement, or
    // tabbing away mid-hold would strand the note.
    release(focusHeld, "focus");
    focusHeld = undefined;
    return;
  }
  const totem = byKey.get(event.key.toLowerCase());
  if (!totem) return;
  release(godOf(totem), `key-${event.key.toLowerCase()}`);
});

// --- Letting go for the player -----------------------------------------
// A key held while the window loses focus never delivers its keyup, and a
// hidden tab should not keep seven oscillators running.

function panic(): void {
  tracks.clear();
  focusHeld = undefined;
  releaseAll();
  startFrames();
}

window.addEventListener("blur", panic);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden") return;
  panic();
  idle();
});

// --- Mute --------------------------------------------------------------

const mute = document.querySelector<HTMLButtonElement>("[data-mute]");
let muted = false;

mute?.addEventListener("click", () => {
  muted = !muted;
  // A real two-state toggle, so aria-pressed genuinely means something here
  // in a way it never did on the totems. The label stays "Mute" --- swapping
  // it to "Unmute" would make the button's name and its pressed state say
  // two different things.
  mute.setAttribute("aria-pressed", String(muted));
  mute.classList.toggle("is-muted", muted);
  setLevel(muted ? 0 : FULL_LEVEL);
});
