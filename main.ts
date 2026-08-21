// Pantheon --- seven carved totems, seven gods, seven chords.
//
// Each totem is one diatonic triad of C major, so any combination a player
// strikes stays in key: that's what "nothing you play is wrong" means here,
// not just a claim on the page.
//
// There is exactly one way to interact: strike the stone. Nothing to adjust,
// no parameters --- so tone has to come from the playing itself, and it comes
// from two places:
//
//   * WHERE you strike a totem (its vertical position) sets that chord's
//     loudness, attack, arpeggio speed, and brightness together.
//   * HEAT --- a value that rises with every strike and cools when you rest.
//     Play hard and the pantheon wakes: everything opens up and brightens.
//     Leave it alone and it settles back down. A long-held chord mellows on
//     its own.
//
// Two players therefore never sound the same, and the same player never
// sounds the same twice.

type ChordId = "C" | "Dm" | "Em" | "F" | "G" | "Am" | "Bdim";

// MIDI note numbers for each triad's equal-tempered pitches (A4 = 440 Hz).
// Computed from a formula below, never approximated.
const NOTES: Record<ChordId, number[]> = {
  C: [60, 64, 67],
  Dm: [62, 65, 69],
  Em: [64, 67, 71],
  F: [65, 69, 72],
  G: [67, 71, 74],
  Am: [69, 72, 76],
  Bdim: [71, 74, 77],
};

function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// Strike position and heat together decide how open a voice sounds, mapped
// exponentially onto 300-8000 Hz --- pitch perception is logarithmic, so a
// linear map would spend most of its range in the top octave. Darkest is a
// soft strike on a cold pantheon (~840 Hz); brightest is a hard strike at
// full heat (8 kHz).
function cutoffFor(velocity: number, currentHeat: number): number {
  const min = 300;
  const max = 8000;
  return min * (max / min) ** clamp01(0.18 + velocity * 0.52 + currentHeat * 0.3);
}

// The keyboard has no notion of *where* a key was struck, so it always plays
// at this fixed, medium velocity. Pointer and touch are the expressive
// surface; the keyboard is a consistent alternative, not a degraded one.
const KEYBOARD_VELOCITY = 0.55;

const totems = Array.from(document.querySelectorAll<HTMLButtonElement>(".totem"));
const totemByChord = new Map(totems.map((totem) => [totem.dataset.chord as ChordId, totem]));
const totemByKey = new Map(totems.map((totem) => [totem.dataset.key ?? "", totem]));

let audioContext: AudioContext | undefined;
let masterGain: GainNode | undefined;

function ensureAudio(): { context: AudioContext; master: GainNode } {
  if (!audioContext) {
    audioContext = new AudioContext();
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.9;
    masterGain.connect(audioContext.destination);
  }
  // Browsers start a context suspended until a user gesture resumes it.
  if (audioContext.state === "suspended") {
    void audioContext.resume();
  }
  return { context: audioContext, master: masterGain! };
}

// A held chord is a drone (all three notes always audible, quietly) with a
// rotating spotlight (one note at a time boosted louder). That's the texture:
// the harmony is always fully present, but it breathes rather than sitting
// there as a static block chord. Each voice owns its filter, so two chords
// held at once can have different brightness.
interface Voice {
  oscillators: OscillatorNode[];
  gains: GainNode[];
  filter: BiquadFilterNode;
  velocity: number;
  arpeggioTimer: number;
}

const activeVoices = new Map<ChordId, Voice>();
// Which sources ("keyboard", or "pointer-<id>" per touch/mouse pointer) are
// currently holding each chord, so releasing one finger while a key is also
// held doesn't cut the chord early.
const activeSources = new Map<ChordId, Set<string>>();

// --- Heat -------------------------------------------------------------
// Rises on every strike, cools continuously. Drives both the filter (audible)
// and the --heat custom property (visible), so the page and the sound wake up
// together.

const HEAT_PER_STRIKE = 0.14;
const HEAT_DECAY_PER_SECOND = 0.25;

let heat = 0;
let heatFrame = 0;
let lastFrameTime = 0;
let lastFilterUpdate = 0;
let lastAppliedHeat = 0;

function retuneVoice(voice: Voice): void {
  if (!audioContext) return;
  voice.filter.frequency.setTargetAtTime(
    cutoffFor(voice.velocity, heat),
    audioContext.currentTime,
    0.08,
  );
}

function startHeatLoop(): void {
  if (heatFrame) return;
  lastFrameTime = performance.now();

  const step = (now: number): void => {
    heat = Math.max(0, heat - ((now - lastFrameTime) / 1000) * HEAT_DECAY_PER_SECOND);
    lastFrameTime = now;
    document.documentElement.style.setProperty("--heat", heat.toFixed(3));

    // Re-glide sustained voices toward the new heat --- but throttled. One
    // automation event per filter per animation frame is both wasteful and
    // audible as stepping, so only write when heat has actually moved.
    if (now - lastFilterUpdate > 60 && Math.abs(heat - lastAppliedHeat) > 0.01) {
      lastFilterUpdate = now;
      lastAppliedHeat = heat;
      for (const voice of activeVoices.values()) retuneVoice(voice);
    }

    if (heat > 0.001) {
      heatFrame = requestAnimationFrame(step);
      return;
    }

    // Fully cool: land the last update and stop the loop rather than leaving
    // a timer running for the rest of the session.
    heat = 0;
    heatFrame = 0;
    lastAppliedHeat = 0;
    document.documentElement.style.setProperty("--heat", "0");
    for (const voice of activeVoices.values()) retuneVoice(voice);
  };

  heatFrame = requestAnimationFrame(step);
}

function pumpHeat(): void {
  heat = Math.min(1, heat + HEAT_PER_STRIKE);
  startHeatLoop();
}

// --- Voices -----------------------------------------------------------

function setTotemActive(id: ChordId, active: boolean, velocity?: number): void {
  const totem = totemByChord.get(id);
  if (!totem) return;
  totem.setAttribute("aria-pressed", String(active));
  totem.classList.toggle("is-struck", active);
  if (active && velocity !== undefined) {
    totem.style.setProperty("--velocity", String(velocity));
  }
}

function startChord(id: ChordId, source: string, velocity: number): void {
  const sources = activeSources.get(id) ?? new Set<string>();
  activeSources.set(id, sources);
  if (sources.has(source)) return;
  sources.add(source);
  if (activeVoices.has(id)) return; // already sounding from another source

  const { context, master } = ensureAudio();
  const now = context.currentTime;

  // A harder strike (velocity near 1) is louder, snappier, faster and
  // brighter; a soft one is quieter, gentler and slower.
  const droneLevel = 0.05 + velocity * 0.05;
  const spotlightLevel = 0.14 + velocity * 0.14;
  const attack = 0.05 - velocity * 0.035;
  const tickMs = 260 - velocity * 180;

  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = cutoffFor(velocity, heat);
  filter.connect(master);

  const oscillators: OscillatorNode[] = [];
  const gains: GainNode[] = [];

  NOTES[id].forEach((midi, i) => {
    const osc = context.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = midiToFrequency(midi);
    osc.detune.value = (i - 1) * 4; // slight spread across the triad, for warmth
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(droneLevel, now + attack);
    osc.connect(gain);
    gain.connect(filter);
    osc.start();
    oscillators.push(osc);
    gains.push(gain);
  });

  let step = 0;
  const tick = (): void => {
    if (!audioContext) return;
    const t = audioContext.currentTime;
    const spotlight = step % gains.length;
    gains.forEach((gain, i) => {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(i === spotlight ? spotlightLevel : droneLevel, t + 0.04);
    });
    step++;
  };
  tick(); // light the first note immediately, don't wait a full tick
  const arpeggioTimer = window.setInterval(tick, tickMs);

  activeVoices.set(id, { oscillators, gains, filter, velocity, arpeggioTimer });
  setTotemActive(id, true, velocity);
  pumpHeat();
}

function stopChord(id: ChordId, source: string): void {
  const sources = activeSources.get(id);
  if (!sources?.has(source)) return;
  sources.delete(source);
  if (sources.size > 0) return; // still held by another source

  const voice = activeVoices.get(id);
  if (!voice || !audioContext) return;
  activeVoices.delete(id);
  window.clearInterval(voice.arpeggioTimer);

  const now = audioContext.currentTime;
  const release = 0.15;
  for (const gain of voice.gains) {
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + release);
  }
  voice.oscillators.forEach((osc, i) => {
    osc.stop(now + release + 0.01);
    osc.addEventListener("ended", () => {
      osc.disconnect();
      // All three stop together, so tearing the shared filter down with the
      // first one to end is safe --- and stops voices leaking nodes.
      if (i === 0) voice.filter.disconnect();
    });
  });

  setTotemActive(id, false);
}

// --- Input ------------------------------------------------------------

// How hard a totem was struck: vertical position within the stone, bottom =
// hardest. pointer.pressure is a constant 0.5 for mouse and most
// touchscreens, so it isn't a usable signal --- position is, and it behaves
// the same across mouse, trackpad, and touch.
function velocityFromEvent(event: PointerEvent, totem: HTMLElement): number {
  const rect = totem.getBoundingClientRect();
  const fraction = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5;
  return 0.25 + clamp01(fraction) * 0.75;
}

// Pointer (mouse or touch): tracked per pointerId as the *set* of chords that
// pointer currently has sounding. A plain strike holds one chord. Sweeping
// across the row adds each newly-entered totem to the set --- a strum builds
// a ringing cluster rather than swapping one chord for another --- and
// releasing (anywhere, via `window`, not the button) tears down everything
// that pointer built up, so a drag off the row never leaves a chord stuck on.
const pointerChords = new Map<number, Set<ChordId>>();

for (const totem of totems) {
  const id = totem.dataset.chord as ChordId;
  totem.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const chords = pointerChords.get(event.pointerId) ?? new Set<ChordId>();
    pointerChords.set(event.pointerId, chords);
    chords.add(id);
    startChord(id, `pointer-${event.pointerId}`, velocityFromEvent(event, totem));
  });
}

window.addEventListener("pointermove", (event) => {
  const chords = pointerChords.get(event.pointerId);
  if (!chords) return; // this pointer isn't holding anything
  const under = document.elementFromPoint(event.clientX, event.clientY);
  const totem = under instanceof Element ? under.closest<HTMLButtonElement>(".totem") : null;
  if (!totem) return;
  const id = totem.dataset.chord as ChordId;
  if (chords.has(id)) return; // already part of this sweep
  chords.add(id);
  startChord(id, `pointer-${event.pointerId}`, velocityFromEvent(event, totem));
});

function releasePointer(event: PointerEvent): void {
  const chords = pointerChords.get(event.pointerId);
  if (!chords) return;
  pointerChords.delete(event.pointerId);
  for (const id of chords) stopChord(id, `pointer-${event.pointerId}`);
}

window.addEventListener("pointerup", releasePointer);
window.addEventListener("pointercancel", releasePointer);

// Keyboard: global, not per-button, so a key works no matter what has focus.
// `repeat` is ignored so holding a key doesn't re-trigger the attack.
window.addEventListener("keydown", (event) => {
  if (event.repeat) return;
  const totem = totemByKey.get(event.key.toLowerCase());
  if (!totem) return;
  startChord(totem.dataset.chord as ChordId, "keyboard", KEYBOARD_VELOCITY);
});

window.addEventListener("keyup", (event) => {
  const totem = totemByKey.get(event.key.toLowerCase());
  if (!totem) return;
  stopChord(totem.dataset.chord as ChordId, "keyboard");
});
