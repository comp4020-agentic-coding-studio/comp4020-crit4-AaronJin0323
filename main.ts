// A seven-pad chord keyboard. Each pad is one diatonic triad of C major, so
// any combination a player presses stays in key --- that's what "no wrong
// note" means here, not just a claim. A shared low-pass filter, driven by
// the brightness slider, is the one continuous expressive control: same
// chord, different tone depending on where you leave it.

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

interface Voice {
  oscillators: OscillatorNode[];
  gains: GainNode[];
}

const activeVoices = new Map<ChordId, Voice>();
// Which sources ("keyboard", or "pointer-<id>" per touch/mouse pointer) are
// currently holding each chord, so releasing one finger while a key is also
// held doesn't cut the chord early.
const activeSources = new Map<ChordId, Set<string>>();

function setPadActive(id: ChordId, active: boolean): void {
  const pad = padByChord.get(id);
  if (!pad) return;
  pad.setAttribute("aria-pressed", String(active));
  pad.classList.toggle("is-active", active);
}

function startChord(id: ChordId, source: string): void {
  const sources = activeSources.get(id) ?? new Set<string>();
  activeSources.set(id, sources);
  if (sources.has(source)) return;
  sources.add(source);
  if (activeVoices.has(id)) return; // already sounding from another source

  const { context, filter } = ensureAudio();
  const now = context.currentTime;
  const oscillators: OscillatorNode[] = [];
  const gains: GainNode[] = [];

  NOTES[id].forEach((midi, i) => {
    const osc = context.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = midiToFrequency(midi);
    osc.detune.value = (i - 1) * 4; // slight spread across the triad, for warmth
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.015);
    osc.connect(gain);
    gain.connect(filter);
    osc.start();
    oscillators.push(osc);
    gains.push(gain);
  });

  activeVoices.set(id, { oscillators, gains });
  setPadActive(id, true);
}

function stopChord(id: ChordId, source: string): void {
  const sources = activeSources.get(id);
  if (!sources?.has(source)) return;
  sources.delete(source);
  if (sources.size > 0) return; // still held by another source

  const voice = activeVoices.get(id);
  if (!voice || !audioContext) return;
  activeVoices.delete(id);

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

// Pointer (mouse or touch): tracked per pointerId so multiple fingers can
// each hold their own chord, and so a chord can't stick on if the pointer
// drifts off the pad before release --- release is handled on `window`, not
// the pad itself.
const pointerChords = new Map<number, ChordId>();

for (const pad of pads) {
  const id = pad.dataset.chord as ChordId;
  pad.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    pointerChords.set(event.pointerId, id);
    startChord(id, `pointer-${event.pointerId}`);
  });
}

function releasePointer(event: PointerEvent): void {
  const id = pointerChords.get(event.pointerId);
  if (id === undefined) return;
  pointerChords.delete(event.pointerId);
  stopChord(id, `pointer-${event.pointerId}`);
}

window.addEventListener("pointerup", releasePointer);
window.addEventListener("pointercancel", releasePointer);

// Keyboard: global, not per-button, so a key works no matter what has
// focus. `repeat` is ignored so holding a key doesn't re-trigger the attack.
window.addEventListener("keydown", (event) => {
  if (event.repeat) return;
  const pad = padByKey.get(event.key.toLowerCase());
  if (!pad) return;
  startChord(pad.dataset.chord as ChordId, "keyboard");
});

window.addEventListener("keyup", (event) => {
  const pad = padByKey.get(event.key.toLowerCase());
  if (!pad) return;
  stopChord(pad.dataset.chord as ChordId, "keyboard");
});
