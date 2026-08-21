// A seven-pad chord keyboard. Each pad is one diatonic triad of C major, so
// any combination a player presses stays in key --- that's what "no wrong
// note" means here, not just a claim. A shared low-pass filter, driven by
// the brightness slider, is one continuous expressive control (the
// instrument's overall tone); how and where you press a pad is the other
// --- press position sets that note's loudness, attack, and how fast it
// arpeggiates, so the same chord sounds different depending on how you play
// it, and dragging across pads strums up a ringing cluster instead of
// firing one chord at a time.

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

function cutoffFor(sliderValue: number): number {
  // 0-100 mapped exponentially onto 300-8000 Hz --- pitch perception is
  // logarithmic, so a linear slider would spend most of its travel in the
  // top octave.
  const min = 300;
  const max = 8000;
  return min * (max / min) ** (sliderValue / 100);
}

// Keyboard has no notion of "where" a key was pressed, so it always plays
// at this fixed, medium velocity. Pointer/touch is the primary expressive
// surface; keyboard is a consistent fallback, not a degraded one.
const KEYBOARD_VELOCITY = 0.55;

const pads = Array.from(document.querySelectorAll<HTMLButtonElement>(".pad"));
const padByChord = new Map(pads.map((pad) => [pad.dataset.chord as ChordId, pad]));
const padByKey = new Map(pads.map((pad) => [pad.dataset.key ?? "", pad]));
const brightness = document.querySelector<HTMLInputElement>("#brightness");

let audioContext: AudioContext | undefined;
let filterNode: BiquadFilterNode | undefined;

function ensureAudio(): { context: AudioContext; filter: BiquadFilterNode } {
  if (!audioContext) {
    audioContext = new AudioContext();
    filterNode = audioContext.createBiquadFilter();
    filterNode.type = "lowpass";
    filterNode.frequency.value = cutoffFor(Number(brightness?.value ?? 55));
    const master = audioContext.createGain();
    master.gain.value = 0.9;
    filterNode.connect(master);
    master.connect(audioContext.destination);
  }
  if (audioContext.state === "suspended") {
    void audioContext.resume();
  }
  return { context: audioContext, filter: filterNode! };
}

brightness?.addEventListener("input", () => {
  if (!audioContext || !filterNode) return;
  filterNode.frequency.setTargetAtTime(
    cutoffFor(Number(brightness.value)),
    audioContext.currentTime,
    0.05,
  );
});

// A held chord is a drone (all three notes always audible, quietly) with a
// rotating spotlight (one note at a time boosted louder). That's the
// "hold-to-arpeggiate" texture: the harmony is always fully present, but
// it's alive rather than a static block chord.
interface Voice {
  oscillators: OscillatorNode[];
  gains: GainNode[];
  droneLevel: number;
  spotlightLevel: number;
  arpeggioTimer: number;
}

const activeVoices = new Map<ChordId, Voice>();
// Which sources ("keyboard", or "pointer-<id>" per touch/mouse pointer) are
// currently holding each chord, so releasing one finger while a key is also
// held doesn't cut the chord early.
const activeSources = new Map<ChordId, Set<string>>();

function setPadActive(id: ChordId, active: boolean, velocity?: number): void {
  const pad = padByChord.get(id);
  if (!pad) return;
  pad.setAttribute("aria-pressed", String(active));
  pad.classList.toggle("is-active", active);
  if (active && velocity !== undefined) {
    pad.style.setProperty("--velocity", String(velocity));
  }
}

function startChord(id: ChordId, source: string, velocity: number): void {
  const sources = activeSources.get(id) ?? new Set<string>();
  activeSources.set(id, sources);
  if (sources.has(source)) return;
  sources.add(source);
  if (activeVoices.has(id)) return; // already sounding from another source

  const { context, filter } = ensureAudio();
  const now = context.currentTime;
  // Harder press (velocity closer to 1): louder, snappier attack, faster
  // arpeggio. Softer press: quieter, gentler attack, slower arpeggio.
  const droneLevel = 0.05 + velocity * 0.05;
  const spotlightLevel = 0.14 + velocity * 0.14;
  const attack = 0.05 - velocity * 0.035;
  const tickMs = 260 - velocity * 180;

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
    const spotlightIndex = step % gains.length;
    gains.forEach((gain, i) => {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(i === spotlightIndex ? spotlightLevel : droneLevel, t + 0.04);
    });
    step++;
  };
  tick(); // light the first note immediately, don't wait a full tick
  const arpeggioTimer = window.setInterval(tick, tickMs);

  activeVoices.set(id, { oscillators, gains, droneLevel, spotlightLevel, arpeggioTimer });
  setPadActive(id, true, velocity);
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
  for (const osc of voice.oscillators) {
    osc.stop(now + release + 0.01);
    osc.addEventListener("ended", () => osc.disconnect());
  }

  setPadActive(id, false);
}

// How hard/where a pad was pressed: vertical position within the pad,
// bottom = hardest. pointer.pressure is a constant 0.5 for mouse and most
// touchscreens, so it isn't a usable signal --- position is, and works the
// same way across mouse, trackpad, and touch.
function velocityFromEvent(event: PointerEvent, pad: HTMLElement): number {
  const rect = pad.getBoundingClientRect();
  const fraction = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5;
  const clamped = Math.min(1, Math.max(0, fraction));
  return 0.25 + clamped * 0.75;
}

// Pointer (mouse or touch): tracked per pointerId as the *set* of chords
// that pointer currently has sounding. A plain tap holds one chord, same as
// before. Dragging across pads adds each newly-entered pad to the set ---
// a strum builds a ringing cluster rather than swapping one chord for
// another --- and releasing the pointer (anywhere, via `window`, not the
// pad) tears down everything that pointer built up, so a drag off the row
// never leaves a chord stuck on.
const pointerPads = new Map<number, Set<ChordId>>();

for (const pad of pads) {
  const id = pad.dataset.chord as ChordId;
  pad.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const chords = pointerPads.get(event.pointerId) ?? new Set<ChordId>();
    pointerPads.set(event.pointerId, chords);
    chords.add(id);
    startChord(id, `pointer-${event.pointerId}`, velocityFromEvent(event, pad));
  });
}

window.addEventListener("pointermove", (event) => {
  const chords = pointerPads.get(event.pointerId);
  if (!chords) return; // this pointer isn't holding anything
  const target = document.elementFromPoint(event.clientX, event.clientY);
  const pad = target instanceof Element ? target.closest<HTMLButtonElement>(".pad") : null;
  if (!pad) return;
  const id = pad.dataset.chord as ChordId;
  if (chords.has(id)) return; // already part of this strum
  chords.add(id);
  startChord(id, `pointer-${event.pointerId}`, velocityFromEvent(event, pad));
});

function releasePointer(event: PointerEvent): void {
  const chords = pointerPads.get(event.pointerId);
  if (!chords) return;
  pointerPads.delete(event.pointerId);
  for (const id of chords) stopChord(id, `pointer-${event.pointerId}`);
}

window.addEventListener("pointerup", releasePointer);
window.addEventListener("pointercancel", releasePointer);

// Keyboard: global, not per-button, so a key works no matter what has
// focus. `repeat` is ignored so holding a key doesn't re-trigger the attack.
window.addEventListener("keydown", (event) => {
  if (event.repeat) return;
  const pad = padByKey.get(event.key.toLowerCase());
  if (!pad) return;
  startChord(pad.dataset.chord as ChordId, "keyboard", KEYBOARD_VELOCITY);
});

window.addEventListener("keyup", (event) => {
  const pad = padByKey.get(event.key.toLowerCase());
  if (!pad) return;
  stopChord(pad.dataset.chord as ChordId, "keyboard");
});
