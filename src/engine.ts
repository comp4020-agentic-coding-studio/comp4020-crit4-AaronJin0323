// The shared audio plant: one context, one output chain, one clock.
//
// Everything the gods make goes through here, which is what keeps seven
// simultaneous voices from turning into mud or clipping. The gods themselves
// know nothing about the output stage --- they connect to `dry` (heard now)
// and `echo` (heard again, further away), and the plant handles the rest.

export interface Buses {
  context: AudioContext;
  /** Direct path. Almost everything connects here. */
  dry: GainNode;
  /** Send into the shared ping-pong delay. Distance, not reverb. */
  echo: GainNode;
  /** Player-facing output level; the mute control rides this. */
  master: GainNode;
}

// --- Theory ------------------------------------------------------------
// One pitch system for the whole pantheon: C major, with its relative minor
// (A aeolian) available for the darker gods. Because every god draws from
// these same seven pitch classes, any combination of gods is consonant ---
// that is the mechanism behind "no wrong combination", not a claim about it.

export const MAJOR = [0, 2, 4, 5, 7, 9, 11];

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Map 0-1 exponentially onto a frequency range --- hearing is logarithmic. */
export function expScale(t: number, min: number, max: number): number {
  return min * (max / min) ** clamp01(t);
}

// --- Shared buffers ----------------------------------------------------
// Built once and reused. Regenerating two seconds of noise per thunder crack
// would allocate megabytes during fast play.

let noiseBuffer: AudioBuffer | undefined;

export function whiteNoise(context: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;
  const length = context.sampleRate * 2;
  noiseBuffer = context.createBuffer(1, length, context.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

// Typed as Float32Array<ArrayBuffer>, not the default Float32Array, because
// WaveShaperNode.curve refuses anything that might be backed by a
// SharedArrayBuffer.
let driveCurve: Float32Array<ArrayBuffer> | undefined;

/** A soft-clip curve for Ares. tanh saturates rather than shattering. */
export function saturation(): Float32Array<ArrayBuffer> {
  if (driveCurve) return driveCurve;
  const n = 1024;
  driveCurve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    driveCurve[i] = Math.tanh(x * 2.6);
  }
  return driveCurve;
}

// --- The plant ---------------------------------------------------------

let buses: Buses | undefined;
/** Remembered across a rebuild, and honoured if the player mutes before the
    context has ever been created. */
let masterLevel = 0.8;

function build(): Buses {
  const context = new AudioContext();

  // Last thing before the speakers. Seven gods at once can easily sum past
  // 0 dBFS; the compressor turns what would be digital clipping into a bit
  // of glue instead. It is protection, not an effect --- hence the high
  // threshold and gentle ratio.
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -14;
  limiter.knee.value = 22;
  limiter.ratio.value = 6;
  limiter.attack.value = 0.004;
  limiter.release.value = 0.18;
  limiter.connect(context.destination);

  const master = context.createGain();
  master.gain.value = masterLevel;
  master.connect(limiter);

  const dry = context.createGain();
  dry.connect(master);

  // Ping-pong delay: Artemis's arrows fly across the stereo field and Hades's
  // echo comes back from somewhere further down. Deliberately modest --- the
  // damping filter inside the feedback path means repeats lose their top end
  // each time round and die out instead of accumulating into wash.
  const echo = context.createGain();
  const left = context.createDelay(1);
  const right = context.createDelay(1);
  left.delayTime.value = 0.24;
  right.delayTime.value = 0.36;

  const damp = context.createBiquadFilter();
  damp.type = "lowpass";
  damp.frequency.value = 2400;

  const feedback = context.createGain();
  feedback.gain.value = 0.3;

  const panLeft = context.createStereoPanner();
  const panRight = context.createStereoPanner();
  panLeft.pan.value = -0.75;
  panRight.pan.value = 0.75;

  const echoReturn = context.createGain();
  echoReturn.gain.value = 0.55;

  echo.connect(left);
  left.connect(damp);
  damp.connect(right);
  // The cycle is legal because it passes through delay nodes.
  right.connect(feedback);
  feedback.connect(left);
  left.connect(panLeft);
  right.connect(panRight);
  panLeft.connect(echoReturn);
  panRight.connect(echoReturn);
  echoReturn.connect(master);

  return { context, dry, echo, master };
}

/**
 * The context is created on the first gesture and resumed on every one, so
 * the gesture that unlocks audio is also the gesture that plays --- nothing
 * is spent on a silent "tap to enable" step.
 */
export function getAudio(): Buses {
  if (!buses) buses = build();
  if (buses.context.state === "suspended") void buses.context.resume();
  return buses;
}

/** Undefined until the first gesture; lets callers avoid forcing a context. */
export function peekAudio(): Buses | undefined {
  return buses;
}

/** The mute control. Ramped, because jumping a gain to zero is a click. */
export function setLevel(next: number): void {
  masterLevel = next;
  if (!buses) return; // nothing built yet; build() will pick this up
  const now = buses.context.currentTime;
  buses.master.gain.cancelScheduledValues(now);
  buses.master.gain.setValueAtTime(buses.master.gain.value, now);
  buses.master.gain.linearRampToValueAtTime(next, now + 0.08);
}

export const FULL_LEVEL = 0.8;

/** Hand the audio hardware back when the tab is hidden. */
export function idle(): void {
  if (buses && buses.context.state === "running") void buses.context.suspend();
}

// --- Transport ---------------------------------------------------------
// The rhythmic gods (Demeter, Apollo, Artemis, Ares) share one clock, which
// is why they lock together instead of drifting into a phase mess.
//
// This is the standard Web Audio lookahead pattern: a coarse timer wakes up
// often, and each time it schedules every beat falling inside a short window
// ahead of the audio clock. Notes therefore land on sample-accurate times
// even though setInterval itself is sloppy and stalls under load.

export type TickListener = (time: number, step: number) => void;

export const BPM = 84;
/** One sixteenth note, the transport's resolution. */
export const STEP_SECONDS = 60 / BPM / 4;

const TIMER_MS = 25;
const LOOKAHEAD_SECONDS = 0.12;

const listeners = new Set<TickListener>();
let timer = 0;
let nextStepTime = 0;
let stepCount = 0;

function pump(): void {
  const audio = peekAudio();
  if (!audio) return;
  while (nextStepTime < audio.context.currentTime + LOOKAHEAD_SECONDS) {
    // Deleting a listener mid-iteration is safe on a Set, which matters
    // because a god can release itself from inside its own tick.
    for (const listener of listeners) listener(nextStepTime, stepCount);
    nextStepTime += STEP_SECONDS;
    stepCount++;
  }
}

export function subscribe(listener: TickListener): void {
  listeners.add(listener);
  if (timer) return;
  const audio = getAudio();
  // Start on a fresh downbeat so the first god in sets the grid.
  stepCount = 0;
  nextStepTime = audio.context.currentTime + 0.06;
  timer = window.setInterval(pump, TIMER_MS);
  pump();
}

export function unsubscribe(listener: TickListener): void {
  listeners.delete(listener);
  // No rhythmic god left: stop the clock rather than leave a timer running
  // for the rest of the session.
  if (listeners.size === 0 && timer) {
    window.clearInterval(timer);
    timer = 0;
  }
}
