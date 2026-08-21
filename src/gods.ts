// The seven voices.
//
// Each god is a factory that builds its own little graph, starts sounding
// immediately, and hands back three ways to talk to it: `update` (the player
// moved), `setRelation` (another god is present), and `release` (let go).
// Nothing here reaches for the DOM or for another god directly --- gods only
// influence each other through relation amounts handed down by pantheon.ts,
// which is what keeps seven voices from becoming a web of special cases.
//
// Everything is diatonic to C major / A minor, so any combination is
// consonant by construction.

import type { Buses } from "./engine.ts";
import {
  clamp01,
  expScale,
  lerp,
  midiToFrequency,
  saturation,
  subscribe,
  unsubscribe,
  whiteNoise,
} from "./engine.ts";

export type GodId = "zeus" | "poseidon" | "hades" | "demeter" | "apollo" | "artemis" | "ares";

export const GOD_IDS: GodId[] = [
  "zeus",
  "poseidon",
  "hades",
  "demeter",
  "apollo",
  "artemis",
  "ares",
];

/** Where the player is and how fast they got there. All values 0-1. */
export interface Gesture {
  /** 0 at the bottom of the screen, 1 at the top. Brightness and register. */
  y: number;
  /** 0 left, 1 right. Stereo placement and spread. */
  x: number;
  /** 0 still, 1 flung. Attack sharpness and intensity. */
  speed: number;
}

export type Relation =
  | "storm" // Zeus + Poseidon
  | "answer" // Apollo + Artemis
  | "cycle" // Hades + Demeter
  | "march" // Ares + however many others
  | "axis"; // Zeus + Poseidon + Hades

export interface GodVoice {
  update(gesture: Gesture): void;
  setRelation(relation: Relation, amount: number): void;
  release(): void;
}

/**
 * The one piece of shared musical state: what Apollo last played, so Artemis
 * can answer it. Passing this through pantheon.ts would mean threading a
 * pitch through three layers to be read once.
 */
export const chorus = { apolloMidi: 76 };

// --- Shared building blocks -------------------------------------------

/** Ramp down, then free every node once the sources have actually ended. */
function teardown(
  at: number,
  sources: AudioScheduledSourceNode[],
  nodes: AudioNode[],
): void {
  if (sources.length === 0) return;
  for (const source of sources) source.stop(at);
  sources[0].onended = () => {
    for (const source of sources) source.disconnect();
    for (const node of nodes) node.disconnect();
  };
}

/** Fade `gain` to silence over `tail` seconds without a click. */
function fadeOut(gain: GainNode, now: number, tail: number): void {
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + tail);
}

interface PluckOptions {
  midi: number;
  gain: number;
  decay: number;
  cutoff: number;
  pan: number;
  type?: OscillatorType;
  /** How much of this note also goes to the shared delay. */
  echo?: number;
}

/**
 * One short note. Every node is disposable and disconnects itself when the
 * oscillator ends, so a long ostinato doesn't accumulate a graph.
 */
function pluck(buses: Buses, at: number, options: PluckOptions): void {
  const { context, dry, echo } = buses;
  const osc = context.createOscillator();
  osc.type = options.type ?? "triangle";
  osc.frequency.setValueAtTime(midiToFrequency(options.midi), at);

  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(options.cutoff, at);

  const level = context.createGain();
  level.gain.setValueAtTime(0.0001, at);
  level.gain.linearRampToValueAtTime(options.gain, at + 0.008);
  level.gain.exponentialRampToValueAtTime(0.0001, at + options.decay);

  const pan = context.createStereoPanner();
  pan.pan.setValueAtTime(Math.max(-1, Math.min(1, options.pan)), at);

  osc.connect(filter);
  filter.connect(level);
  level.connect(pan);
  pan.connect(dry);

  let send: GainNode | undefined;
  if (options.echo) {
    send = context.createGain();
    send.gain.value = options.echo;
    pan.connect(send);
    send.connect(echo);
  }

  osc.start(at);
  const end = at + options.decay + 0.05;
  osc.stop(end);
  osc.onended = () => {
    osc.disconnect();
    filter.disconnect();
    level.disconnect();
    pan.disconnect();
    send?.disconnect();
  };
}

// --- Zeus: sky and thunder --------------------------------------------
// Open fifths high up (no third, so he never argues with a god who wants the
// harmony major or minor), a lightning transient on the strike, and a rumble
// that takes seconds to build --- holding Zeus is a storm gathering, not a
// longer version of tapping him.

export function createZeus(buses: Buses, initial: Gesture): GodVoice {
  const { context, dry, echo } = buses;
  const t0 = context.currentTime;
  let gesture = initial;
  let storm = 0;
  let axis = 0;
  let released = false;

  const out = context.createGain();
  const pan = context.createStereoPanner();
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 0.7;
  filter.connect(out);
  out.connect(pan);
  pan.connect(dry);

  const sources: AudioScheduledSourceNode[] = [];
  const nodes: AudioNode[] = [filter, out, pan];

  [72, 79, 84].forEach((midi, i) => {
    const osc = context.createOscillator();
    osc.type = i === 2 ? "triangle" : "sawtooth";
    osc.frequency.value = midiToFrequency(midi);
    osc.detune.value = (i - 1) * 7;
    const level = context.createGain();
    level.gain.value = i === 2 ? 0.15 : 0.24;
    osc.connect(level);
    level.connect(filter);
    osc.start(t0);
    sources.push(osc);
    nodes.push(level);
  });

  const rumble = context.createBufferSource();
  rumble.buffer = whiteNoise(context);
  rumble.loop = true;
  const rumbleFilter = context.createBiquadFilter();
  rumbleFilter.type = "lowpass";
  rumbleFilter.frequency.value = 120;
  const rumbleGain = context.createGain();
  rumbleGain.gain.value = 0.0001;
  rumbleGain.gain.setTargetAtTime(0.3, t0, 2.4);
  rumble.connect(rumbleFilter);
  rumbleFilter.connect(rumbleGain);
  rumbleGain.connect(out);
  rumble.start(t0);
  sources.push(rumble);
  nodes.push(rumbleFilter, rumbleGain);

  function crack(intensity: number): void {
    const at = context.currentTime;
    const burst = context.createBufferSource();
    burst.buffer = whiteNoise(context);
    burst.loop = true;
    const shape = context.createBiquadFilter();
    shape.type = "highpass";
    shape.frequency.value = lerp(800, 2600, intensity);
    const level = context.createGain();
    level.gain.setValueAtTime(0.0001, at);
    level.gain.linearRampToValueAtTime(0.08 + intensity * 0.2, at + 0.004);
    level.gain.exponentialRampToValueAtTime(0.0001, at + 0.3 + intensity * 0.45);
    burst.connect(shape);
    shape.connect(level);
    level.connect(out);
    level.connect(echo); // the roll that follows the flash
    burst.start(at);
    burst.stop(at + 0.85);
    burst.onended = () => {
      burst.disconnect();
      shape.disconnect();
      level.disconnect();
    };
  }

  function applyTone(): void {
    const now = context.currentTime;
    // The axis relation lifts Zeus into the top of the register so sky, sea
    // and underworld occupy visibly different bands.
    const brightness = clamp01(0.35 + gesture.y * 0.55 + axis * 0.15);
    filter.frequency.setTargetAtTime(expScale(brightness, 700, 9500), now, 0.08);
    pan.pan.setTargetAtTime((gesture.x - 0.5) * 0.5, now, 0.1);
  }

  const attack = lerp(0.09, 0.012, initial.speed);
  out.gain.setValueAtTime(0.0001, t0);
  out.gain.linearRampToValueAtTime(0.2, t0 + attack);
  applyTone();
  crack(initial.speed);

  // Thunder is not metrical, so it gets its own loose timer rather than a
  // seat on the transport. Each crack reschedules the next at a random gap,
  // which is irregular in the way weather is without ever going silent.
  let stormTimer = 0;

  function scheduleCrack(): void {
    stormTimer = window.setTimeout(() => {
      stormTimer = 0;
      if (released || storm === 0) return;
      crack(0.3 + Math.random() * 0.5);
      scheduleCrack();
    }, 900 + Math.random() * 1200);
  }

  return {
    update(next) {
      gesture = next;
      applyTone();
    },
    setRelation(relation, amount) {
      if (relation === "axis") {
        axis = amount;
        applyTone();
        return;
      }
      if (relation !== "storm") return;
      const before = storm;
      storm = amount;
      rumbleGain.gain.setTargetAtTime(0.3 + storm * 0.45, context.currentTime, 1.2);
      if (storm > 0 && before === 0 && !stormTimer) scheduleCrack();
      if (storm === 0 && stormTimer) {
        window.clearTimeout(stormTimer);
        stormTimer = 0;
      }
    },
    release() {
      released = true;
      if (stormTimer) window.clearTimeout(stormTimer);
      const now = context.currentTime;
      const tail = 0.6;
      fadeOut(out, now, tail);
      teardown(now + tail + 0.05, sources, nodes);
    },
  };
}

// --- Poseidon: sea and motion -----------------------------------------
// Deep and smooth when you hold still; the faster you move, the rougher the
// water gets. Movement is the instrument here --- an LFO sweeps the filter
// like a swell, and how hard you stir decides both how fast the swell runs
// and how much surf noise rides on top.

export function createPoseidon(buses: Buses, initial: Gesture): GodVoice {
  const { context, dry } = buses;
  const t0 = context.currentTime;
  let gesture = initial;
  let storm = 0;
  let axis = 0;

  const out = context.createGain();
  const pan = context.createStereoPanner();
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 1.4;
  filter.frequency.value = 420;
  filter.connect(out);
  out.connect(pan);
  pan.connect(dry);

  const sources: AudioScheduledSourceNode[] = [];
  const nodes: AudioNode[] = [filter, out, pan];

  // C2, G2, C3 --- a fifth and its octave, the same open harmony as Zeus but
  // three octaves down.
  [36, 43, 48].forEach((midi, i) => {
    const osc = context.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = midiToFrequency(midi);
    osc.detune.value = (i - 1) * 9;
    const level = context.createGain();
    level.gain.value = i === 2 ? 0.1 : 0.2;
    osc.connect(level);
    level.connect(filter);
    osc.start(t0);
    sources.push(osc);
    nodes.push(level);
  });

  const swell = context.createOscillator();
  swell.type = "sine";
  swell.frequency.value = 0.16;
  const swellDepth = context.createGain();
  swellDepth.gain.value = 160;
  swell.connect(swellDepth);
  swellDepth.connect(filter.frequency);
  swell.start(t0);
  sources.push(swell);
  nodes.push(swellDepth);

  const surf = context.createBufferSource();
  surf.buffer = whiteNoise(context);
  surf.loop = true;
  const surfBand = context.createBiquadFilter();
  surfBand.type = "bandpass";
  surfBand.frequency.value = 900;
  surfBand.Q.value = 0.6;
  const surfGain = context.createGain();
  surfGain.gain.value = 0.0001;
  surf.connect(surfBand);
  surfBand.connect(surfGain);
  surfGain.connect(out);
  surf.start(t0);
  sources.push(surf);
  nodes.push(surfBand, surfGain);

  function applyTone(): void {
    const now = context.currentTime;
    const roughness = clamp01(gesture.speed + storm * 0.35);
    // Calm water is dark and still; rough water is brighter, faster, noisier.
    filter.frequency.setTargetAtTime(
      expScale(0.1 + gesture.y * 0.35 + roughness * 0.25 - axis * 0.08, 180, 2600),
      now,
      0.25,
    );
    swell.frequency.setTargetAtTime(0.12 + roughness * 0.85, now, 0.5);
    swellDepth.gain.setTargetAtTime(140 + roughness * 380, now, 0.5);
    surfGain.gain.setTargetAtTime(0.015 + roughness * 0.14, now, 0.2);
    surfBand.frequency.setTargetAtTime(700 + roughness * 1800, now, 0.3);
    pan.pan.setTargetAtTime((gesture.x - 0.5) * 0.35, now, 0.2);
  }

  out.gain.setValueAtTime(0.0001, t0);
  out.gain.linearRampToValueAtTime(0.26, t0 + lerp(0.5, 0.12, initial.speed));
  applyTone();

  return {
    update(next) {
      gesture = next;
      applyTone();
    },
    setRelation(relation, amount) {
      if (relation === "storm") storm = amount;
      else if (relation === "axis") axis = amount;
      else return;
      applyTone();
    },
    release() {
      const now = context.currentTime;
      const tail = 1.1; // water doesn't stop dead
      fadeOut(out, now, tail);
      teardown(now + tail + 0.05, sources, nodes);
    },
  };
}

// --- Hades: the underworld --------------------------------------------
// Sub-bass and the relative minor. The longer you hold him the further down
// he goes: the filter target is low and the time constant is long, so the
// sound is always descending toward it rather than sitting still. Letting go
// leaves an echo coming back up from a long way below.

export function createHades(buses: Buses, initial: Gesture): GodVoice {
  const { context, dry, echo } = buses;
  const t0 = context.currentTime;
  let gesture = initial;
  let cycle = 0;
  let axis = 0;

  const out = context.createGain();
  const pan = context.createStereoPanner();
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 2.2;
  filter.frequency.setValueAtTime(1500, t0); // opens dark from a brighter door
  filter.connect(out);
  out.connect(pan);
  pan.connect(dry);

  const send = context.createGain();
  send.gain.value = 0.22;
  pan.connect(send);
  send.connect(echo);

  const sources: AudioScheduledSourceNode[] = [];
  const nodes: AudioNode[] = [filter, out, pan, send];

  // C1 sub, then A1-C2-E2: A minor, the relative minor of everyone else's
  // C major, so Hades is dark without being out of key.
  const sub = context.createOscillator();
  sub.type = "sine";
  sub.frequency.value = midiToFrequency(24);
  const subGain = context.createGain();
  subGain.gain.value = 0.34;
  sub.connect(subGain);
  subGain.connect(filter);
  sub.start(t0);
  sources.push(sub);
  nodes.push(subGain);

  [33, 36, 40].forEach((midi, i) => {
    const osc = context.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = midiToFrequency(midi);
    osc.detune.value = (i - 1) * 6;
    // Sinking pitch: a slow drift flat, which reads as depth rather than as
    // being out of tune.
    osc.detune.setTargetAtTime((i - 1) * 6 - 35, t0, 7);
    const level = context.createGain();
    level.gain.value = 0.15;
    osc.connect(level);
    level.connect(filter);
    osc.start(t0);
    sources.push(osc);
    nodes.push(level);
  });

  function applyTone(): void {
    const now = context.currentTime;
    // Demeter pulls him back toward the surface a little.
    const floor = expScale(gesture.y * 0.4 + cycle * 0.2 + axis * 0.05, 110, 900);
    filter.frequency.setTargetAtTime(floor, now, 3.2);
    pan.pan.setTargetAtTime((gesture.x - 0.5) * 0.25, now, 0.2);
  }

  out.gain.setValueAtTime(0.0001, t0);
  out.gain.linearRampToValueAtTime(0.3, t0 + lerp(0.35, 0.08, initial.speed));
  applyTone();

  return {
    update(next) {
      gesture = next;
      applyTone();
    },
    setRelation(relation, amount) {
      if (relation === "cycle") cycle = amount;
      else if (relation === "axis") axis = amount;
      else return;
      applyTone();
    },
    release() {
      const now = context.currentTime;
      // Growth shortens the tail: Demeter will not let the dark linger.
      const tail = lerp(2.6, 1.3, cycle);
      send.gain.setTargetAtTime(0.5, now, 0.2); // the echo left behind
      fadeOut(out, now, tail);
      teardown(now + tail + 0.05, sources, nodes);
    },
  };
}

// --- Demeter: growth ---------------------------------------------------
// A seed that keeps putting out one more note. She starts with two pitches of
// a pentatonic figure and adds another every few bars up to five, with a pad
// thickening underneath --- so holding her is watching something grow, but it
// is capped so it never runs away into a loop you can't stop.

const DEMETER_SEED = [60, 64, 62, 69, 67]; // C4 E4 D4 A4 G4

export function createDemeter(buses: Buses, initial: Gesture): GodVoice {
  const { context, dry } = buses;
  const t0 = context.currentTime;
  let gesture = initial;
  let cycle = 0;
  let grown = 2;
  let cursor = 0;
  let eighths = 0;

  const pad = context.createGain();
  const padFilter = context.createBiquadFilter();
  padFilter.type = "lowpass";
  padFilter.frequency.value = 700;
  const padPan = context.createStereoPanner();
  padFilter.connect(pad);
  pad.connect(padPan);
  padPan.connect(dry);

  const sources: AudioScheduledSourceNode[] = [];
  const nodes: AudioNode[] = [pad, padFilter, padPan];

  [48, 55].forEach((midi, i) => {
    const osc = context.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = midiToFrequency(midi);
    osc.detune.value = i * 5;
    const level = context.createGain();
    level.gain.value = 0.12;
    osc.connect(level);
    level.connect(padFilter);
    osc.start(t0);
    sources.push(osc);
    nodes.push(level);
  });

  pad.gain.setValueAtTime(0.0001, t0);
  pad.gain.linearRampToValueAtTime(0.16, t0 + 0.4);

  const tick = (time: number, step: number): void => {
    if (step % 2 !== 0) return; // eighth notes
    eighths++;
    // Hades slows the growing season down.
    const every = cycle > 0 ? 12 : 8;
    if (eighths % every === 0 && grown < DEMETER_SEED.length) grown++;

    const midi = DEMETER_SEED[cursor % grown];
    cursor++;
    pluck(buses, time, {
      midi,
      gain: 0.16 + gesture.speed * 0.06,
      decay: 0.5 + gesture.y * 0.3,
      cutoff: expScale(0.3 + gesture.y * 0.5 - cycle * 0.2, 600, 5200),
      pan: (gesture.x - 0.5) * 0.5,
      type: "triangle",
      echo: 0.12,
    });
    // Richness grows with the figure: an octave above, quietly, once
    // she is established.
    if (grown >= 4) {
      pluck(buses, time, {
        midi: midi + 12,
        gain: 0.05,
        decay: 0.35,
        cutoff: 4200,
        pan: (gesture.x - 0.5) * 0.5 + 0.2,
        echo: 0.1,
      });
    }
  };

  subscribe(tick);

  function applyTone(): void {
    const now = context.currentTime;
    padFilter.frequency.setTargetAtTime(expScale(0.2 + gesture.y * 0.4, 400, 2600), now, 0.3);
    padPan.pan.setTargetAtTime((gesture.x - 0.5) * 0.3, now, 0.2);
  }
  applyTone();

  return {
    update(next) {
      gesture = next;
      applyTone();
    },
    setRelation(relation, amount) {
      if (relation !== "cycle") return;
      cycle = amount;
      applyTone();
    },
    release() {
      unsubscribe(tick);
      const now = context.currentTime;
      const tail = 0.9;
      fadeOut(pad, now, tail);
      teardown(now + tail + 0.05, sources, nodes);
    },
  };
}

// --- Apollo: the lyre --------------------------------------------------
// Ordered and radiant: a rising Cmaj7 figure, plucked, always consonant.
// When Artemis is present he drops to the beat and leaves her the off-beats,
// which is the call half of the call and response.

const APOLLO_FIGURE = [72, 76, 79, 83, 79, 76]; // C5 E5 G5 B5 G5 E5

export function createApollo(buses: Buses, initial: Gesture): GodVoice {
  const { context } = buses;
  let gesture = initial;
  let answering = 0;
  let cursor = 0;

  const tick = (time: number, step: number): void => {
    // Alone he runs in eighths; answering, he takes the beat and leaves the
    // space between for Artemis.
    const slot = answering > 0 ? 4 : 2;
    if (step % slot !== 0) return;

    const midi = APOLLO_FIGURE[cursor % APOLLO_FIGURE.length];
    cursor++;
    chorus.apolloMidi = midi;

    const clarity = clamp01(0.35 + gesture.y * 0.6);
    pluck(buses, time, {
      midi,
      gain: 0.15 + gesture.speed * 0.05,
      decay: 0.7,
      cutoff: expScale(clarity, 1400, 9000),
      pan: (gesture.x - 0.5) * 0.4 - 0.12, // sits just left of Artemis
      type: "triangle",
      echo: 0.1,
    });
    // A quiet twelfth above adds the sunlit sheen without adding a pitch
    // outside the chord.
    pluck(buses, time, {
      midi: midi + 19,
      gain: 0.03 + clarity * 0.04,
      decay: 0.3,
      cutoff: 11000,
      pan: (gesture.x - 0.5) * 0.4 - 0.12,
      type: "sine",
    });
  };

  subscribe(tick);

  return {
    update(next) {
      gesture = next;
    },
    setRelation(relation, amount) {
      if (relation === "answer") answering = amount;
    },
    release() {
      unsubscribe(tick);
      void context;
    },
  };
}

// --- Artemis: the hunt -------------------------------------------------
// High, distant and moving. Her notes land between Apollo's and fly across
// the stereo field into the delay, so each one reads as an arrow leaving and
// arriving somewhere else.

const ARTEMIS_FIGURE = [88, 91, 93, 84, 86]; // E6 G6 A6 C6 D6

export function createArtemis(buses: Buses, initial: Gesture): GodVoice {
  const { context } = buses;
  let gesture = initial;
  let answering = 0;
  let cursor = 0;

  const tick = (time: number, step: number): void => {
    if (step % 4 !== 2) return; // the off-beat, opposite Apollo

    // Answering, she takes Apollo's last pitch up an octave --- literally a
    // reply rather than a second independent melody.
    const midi =
      answering > 0
        ? chorus.apolloMidi + 12
        : ARTEMIS_FIGURE[cursor % ARTEMIS_FIGURE.length];
    cursor++;

    // Arrows alternate sides, biased by where the player's hand is.
    const side = cursor % 2 === 0 ? -1 : 1;
    const pan = Math.max(-1, Math.min(1, (gesture.x - 0.5) * 0.6 + side * 0.55));

    pluck(buses, time, {
      midi,
      gain: 0.1 + gesture.speed * 0.06,
      decay: 0.3,
      cutoff: expScale(0.5 + gesture.y * 0.45, 3000, 12000),
      pan,
      type: "sine",
      echo: 0.42 + gesture.speed * 0.2, // distance
    });
  };

  subscribe(tick);

  return {
    update(next) {
      gesture = next;
    },
    setRelation(relation, amount) {
      if (relation === "answer") answering = amount;
    },
    release() {
      unsubscribe(tick);
      void context;
    },
  };
}

// --- Ares: war ---------------------------------------------------------
// Percussion, saturated. He rides the same clock as everyone else, so his
// accents always land with whatever is already playing rather than against
// it, and he quiets down as the pantheon fills up --- war drives the others,
// it does not drown them.

const ARES_PATTERN = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0];

export function createAres(buses: Buses, initial: Gesture): GodVoice {
  const { context, dry } = buses;
  let gesture = initial;
  let others = 0;

  const out = context.createGain();
  out.gain.value = 1;
  const shaper = context.createWaveShaper();
  shaper.curve = saturation();
  shaper.oversample = "2x";
  const pan = context.createStereoPanner();
  out.connect(shaper);
  shaper.connect(pan);
  pan.connect(dry);

  function hit(at: number, intensity: number): void {
    // Body: a pitch envelope from a thump down to a floor tom.
    const osc = context.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, at);
    osc.frequency.exponentialRampToValueAtTime(48, at + 0.13);
    const body = context.createGain();
    body.gain.setValueAtTime(0.0001, at);
    body.gain.linearRampToValueAtTime(0.5 * intensity, at + 0.004);
    body.gain.exponentialRampToValueAtTime(0.0001, at + 0.24);
    osc.connect(body);
    body.connect(out);
    osc.start(at);
    osc.stop(at + 0.3);
    osc.onended = () => {
      osc.disconnect();
      body.disconnect();
    };

    // Edge: a short noise crack so it reads as struck metal, not a kick drum.
    const burst = context.createBufferSource();
    burst.buffer = whiteNoise(context);
    burst.loop = true;
    const edge = context.createBiquadFilter();
    edge.type = "bandpass";
    edge.frequency.value = 2400;
    edge.Q.value = 0.8;
    const snap = context.createGain();
    snap.gain.setValueAtTime(0.0001, at);
    snap.gain.linearRampToValueAtTime(0.18 * intensity, at + 0.003);
    snap.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
    burst.connect(edge);
    edge.connect(snap);
    snap.connect(out);
    burst.start(at);
    burst.stop(at + 0.14);
    burst.onended = () => {
      burst.disconnect();
      edge.disconnect();
      snap.disconnect();
    };
  }

  const tick = (time: number, step: number): void => {
    const slot = step % 16;
    const accent = ARES_PATTERN[slot];
    // With company he also fills the off-beats, quietly --- that is what
    // turns him from a solo drum into the pantheon's pulse.
    const ghost = others > 0 && slot % 4 === 2;
    if (!accent && !ghost) return;

    // The more gods are sounding, the further back he sits.
    const room = 1 / (1 + others * 0.3);
    const intensity = (0.4 + gesture.speed * 0.6) * room * (accent ? 1 : 0.35);
    hit(time, intensity);
  };

  subscribe(tick);

  function applyTone(): void {
    pan.pan.setTargetAtTime((gesture.x - 0.5) * 0.3, context.currentTime, 0.2);
  }
  applyTone();

  return {
    update(next) {
      gesture = next;
      applyTone();
    },
    setRelation(relation, amount) {
      if (relation !== "march") return;
      others = amount;
    },
    release() {
      unsubscribe(tick);
      const now = context.currentTime;
      // Nothing sustains, so just let the last hit ring and free the chain.
      window.setTimeout(() => {
        out.disconnect();
        shaper.disconnect();
        pan.disconnect();
      }, 400);
      void now;
    },
  };
}

// --- Registry ----------------------------------------------------------

export const FACTORIES: Record<GodId, (buses: Buses, gesture: Gesture) => GodVoice> = {
  zeus: createZeus,
  poseidon: createPoseidon,
  hades: createHades,
  demeter: createDemeter,
  apollo: createApollo,
  artemis: createArtemis,
  ares: createAres,
};
