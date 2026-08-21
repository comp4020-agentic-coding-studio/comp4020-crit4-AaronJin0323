# Pantheon — how it works

The design brief in one line: *the player summons gods whose domains become
musical forces.* What you hear is decided by which gods are awake, how you
invoked them, and what those gods do to each other.

The test this is built against: **if the Greek names and the carvings were
hidden, the behaviour alone should still suggest storms, oceans, depth, growth,
sunlight, hunting and war.** Every mapping below is chosen to serve that, not to
be a synthesiser control surface with mythological labels stuck on.

## One interaction

There is exactly one gesture, available three ways.

| | |
|---|---|
| **Press** | `pointerdown` — not `click`. Sound starts on contact. |
| **Hold** | The voice sustains and keeps developing for as long as you hold. |
| **Move while held** | Shapes the sound continuously. |
| **Drag onto another god** | Layers them in; both stay held on one finger. |
| **Release** | The voice decays over its own tail. |
| **Multi-touch** | Every pointer is tracked independently. |
| **Keys A S D F G H J** | Hold to sustain, release to decay, `event.repeat` ignored. |
| **Enter / Space** | Works on a focused totem, so tabbing to a stone isn't a dead end. |

Position is read against the **viewport**, not the button, so dragging across
the pantheon is one continuous shaping movement rather than seven small
coordinate systems that reset at every edge.

| axis | range | meaning |
|---|---|---|
| **Y** | bottom → top | brightness, cutoff, register, intensity |
| **X** | left → right | stereo placement and spread |
| **speed** | slow → fast | attack sharpness, roughness, impact |

**Pressure is deliberately not trusted.** A mouse and most touchscreens report a
hard-coded `pressure` of exactly 0.5, which carries no information. Real
pressure is used only for `pointerType === "pen"` or when the value is
measurably away from 0.5; otherwise the strike intensity comes from how fast the
hand was already travelling on the way in, with a floor so a slow deliberate
press is still audible. Keyboard invocations get a fixed comfortable position
(`y = 0.58`, `x` spread across the row by key order) and a mid strike.

## The seven voices

All seven share one pitch system — **C major, with its relative A aeolian for
the dark gods**. That is the mechanism behind "there is no wrong combination":
it isn't a claim, it's that every god draws from the same seven pitch classes,
so any subset is consonant. Everything is synthesised; there are no samples and
no prerecorded audio anywhere.

### Zeus — sky and thunder
Three oscillators at **C5 / G5 / C6** (MIDI 72, 79, 84) — bare open fifths, saw
+ saw + triangle, slightly detuned. An electrical transient opens the note
(attack tightens from 90 ms to 12 ms with strike speed). Held, a filtered noise
bed rises underneath as a storm rumble, and lightning cracks fire at random
900–2100 ms gaps: a noise burst through a highpass that climbs with intensity,
sent to both the direct path and the echo so the thunder rolls away.
**Y** sweeps the lowpass 700 Hz → 9.5 kHz. **X** pans ±0.5.

### Poseidon — sea and swell
Three detuned saws at **C2 / G2 / C3** (36, 43, 48) under a resonant lowpass
(Q 1.4) with a slow 0.16 Hz LFO breathing across the cutoff — that is the swell.
Attack is long (500 ms, shortening to 120 ms on a fast strike): he arrives, he
doesn't strike. Movement makes waves: pointer speed feeds a `roughness` term
that simultaneously opens the filter, speeds the LFO to ~1 Hz, deepens its
excursion, and raises a band-passed surf noise from 0.015 to 0.15. **Move
faster and the sea gets rougher and noisier**, exactly as specified.
**Y** sweeps 180 Hz → 2.6 kHz. **X** pans ±0.35 — narrower than Zeus, because
the sea is everywhere.

### Hades — the underworld
A sine sub at **MIDI 24** (~32 Hz) plus triangles at **A1 / C2 / E2** (33, 36,
40) — A minor, the relative minor of the shared key. Two things make it the
underworld rather than just a bass patch:

- **It descends as you hold it.** Every oscillator's detune drifts −35 cents
  over a 7-second time constant, and the filter cutoff is driven with a **3.2 s
  time constant** so the tone keeps sinking for the whole hold instead of
  arriving at its target and stopping.
- **It answers on release.** A permanent echo send opens up when you let go, so
  the last thing you hear is the sound coming back from somewhere further down.
  The decay tail is 2.6 s, the longest of the seven.

### Demeter — growth and harvest
The only god that *grows*. A five-note seed — **C4 E4 D4 A4 G4** — plays on the
transport's eighth notes, but only the first **two** notes exist when she wakes.
Every eight eighths another note of the seed is unlocked, up to all five; once
four are growing, each note gains an octave-above partner and the line thickens.
A quiet triangle pad (C3 + G3) holds underneath. The ostinato is therefore never
random and never static — hold her and the phrase visibly lengthens and enriches
while staying in key. **Y** controls both pluck decay and brightness.

### Apollo — sunlight and the lyre
Clear plucked lyre figures on **C5 E5 G5 B5 G5 E5** — a Cmaj7 arpeggio up and
back, ordered and radiant. Each pluck is a filtered saw with a short exponential
decay plus a quiet sine a twelfth above for the shine. He plays **on the beat**
(every other sixteenth). **Y** sweeps his cutoff 1.4 kHz → 9 kHz — the
brightest range of any god, which is the point. Panned slightly left.

### Artemis — the hunt and the moon
High, short plucks — **E6 G6 A6 C6 D6** — with a heavy send into the shared
ping-pong delay, so her arrows fly across the stereo field and come back from
the other side. She plays on the **off-beat**, alternating pan sides each note.
Cutoff runs 3 kHz → 12 kHz. Her echo send rises with movement speed, so a fast
hand throws the notes further.

### Ares — war and the drum
Purely percussive, on a fixed sixteen-step pattern
(`1 0 0 0 · 0 0 1 0 · 0 0 1 0 · 0 1 0 0`) — a limping martial figure, not a
four-on-the-floor. Each hit is a sine with a 150 → 48 Hz pitch envelope plus a
band-passed noise snap, both through a shared `tanh` waveshaper at 2× oversample
for controlled distortion. **Strike intensity scales the impact directly.**
Critically, his whole output is divided by `1 + (other gods awake) × 0.3`, so he
adds energy to a texture instead of flattening it.

## The five relationships

These are always on. They are not secrets, achievements or requirements, and
nothing implies one combination is better than another — they are just what
happens when two domains meet. All five are recomputed from scratch whenever any
god wakes or sleeps.

| gods | what you hear | measured evidence |
|---|---|---|
| **Zeus + Poseidon** — *storm* | Zeus's rumble bed rises and the lightning keeps striking instead of trailing off; Poseidon's sea roughens under it. A thunderstorm, not two sounds. | Zeus alone schedules 3 sources; with Poseidon, 7. |
| **Apollo + Artemis** — *answer* | Apollo drops to the beat and leaves the off-beats to Artemis, who replies with **his exact last note an octave up**. Call and response. | 8 call-and-response pairs measured in 26 notes (reply an exact octave above the call, 0.3–0.42 s later). |
| **Hades + Demeter** — *cycle* | Demeter's growth lifts the underworld's ceiling while Hades darkens and shortens her line. Decay and growth arguing. | Hades' settled filter floor rises from 179 Hz alone to 273 Hz with Demeter awake. |
| **Ares + anything sustained** — *march* | War fills the gaps: ghost hits appear on the off-beats of whatever is already sounding, and the whole kit steps back in level as more gods join. | Ares alone lands 9 hits' worth; with Zeus, 16. |
| **Zeus + Poseidon + Hades** — *axis* | Sky, sea and underworld separate: Zeus brightens upward, Poseidon narrows, Hades sinks. The three realms stop occupying the same space. | — |

## Cold start and the inscription

The page opens with **"The pantheon sleeps. Touch a god to invoke them."** and a
quieter **"Touch, hold and move · Keys A–J"**.

The **first gesture both resumes the audio context and produces sound** — there
is no silent unlock tap. `getAudio()` creates the context if needed, resumes it
if suspended, and returns the buses, and it is called from inside the same
`pointerdown` that builds the voice. Verified: the first press schedules 3
oscillators.

After that the inscription describes the *actual* state, never a score:

> "Zeus commands the sky." · "Thunder rolls across Poseidon's sea." · "Apollo
> and Artemis answer one another." · "Demeter's green pushes up through Hades'
> dark." · "Sky, sea and underworld divide the world between them." · "The
> echoes return to Olympus."

It is debounced by 700 ms — a four-god strum otherwise fires four screen-reader
announcements in half a second and the live region becomes noise.

> **Note on a reversed instruction.** An earlier direction in this project was
> *"there should be no instruction for users, it is fun for them to explore."*
> This revision explicitly mandates the opening copy and the keyboard hint
> above, so the on-page instructions are back by request. Flagging it so the
> change reads as deliberate rather than as drift.

## Visuals

Each god writes a `--g-<name>` custom property (0–1) onto `:root` from a
single self-stopping `requestAnimationFrame` loop; CSS does everything else. No
per-god JS animation, no layout thrash.

Zeus lights the upper atmosphere and cracks it with lightning; Poseidon rolls
slow waves across the lower field; Hades deepens and violets the bottom of the
scene; Demeter grows a green ornament; Apollo warms the whole page; Artemis
scatters cool moving points; Ares pulses restrained impacts locked to his four
accents (a `2.857s` cycle — exactly one bar at 84 bpm).

**The lit state lasts as long as the sound, not as long as the click.** Each god
declares its real audible tail (Hades 3.6 s, Zeus 1.8 s, Ares 0.5 s, …) and the
glow decays exponentially to reach its cut-off exactly at the end of that
window. This was a real bug caught in verification: a hand-picked decay rate had
Hades' stone still 19% lit 4.6 s after release, long after silence. It now
measures 0.46 at 600 ms (audible) and 0.00 at 4.6 s (silent).

Everything animated sits inside `@media (prefers-reduced-motion: no-preference)`.
Colour is never the only signal: an awake stone also brightens its name and
scales up a plinth bar beneath the key letter, and the inscription says in words
what is awake.

## Audio engineering

- **One shared `AudioContext`**, created lazily on the first gesture and reused
  for the session. The existing context was reused, not replaced.
- **Output chain:** every god → `dry` (and optionally `echo`) → `master` →
  `DynamicsCompressorNode` → destination. The compressor is protection, not an
  effect: threshold −14 dB, knee 22, ratio 6, 4 ms attack. Master sits at 0.8.
- **No clicks.** Every gain change is a ramp. Fade-outs `cancelScheduledValues`,
  pin the current value, then exponentially ramp to 0.0001 — never to zero,
  which `exponentialRampToValueAtTime` refuses.
- **Nothing leaks.** Every voice stops its sources and disconnects every node it
  built from the first source's `onended`. Measured after a heavy multi-god
  session: **687 nodes created, 676 freed, 11 live** — and 11 is exactly the
  size of the permanent output plant.
- **No effect buildup.** One shared ping-pong delay (0.24 s / 0.36 s, feedback
  0.3) with a 2.4 kHz lowpass *inside* the feedback loop, so repeats lose their
  top end each pass and die instead of accumulating into wash. There is no
  reverb.
- **Safe combined gain.** All seven gods held at once measures a peak of
  **0.540** at the analyser spliced before `destination`: loud enough to be
  clearly audible, nowhere near clipping.
- **No allocation in the pointer path.** Each pointer owns one mutable `Gesture`
  object that is written in place; shared noise buffers and the saturation curve
  are built once and cached. Audio automation is throttled to ~30 Hz inside the
  frame loop rather than firing on every 120 Hz pointer event — seven voices ×
  a dozen params per move is how you make a filter crackle.
- **One clock.** The four rhythmic gods share a 25 ms / 120 ms-lookahead
  scheduler at 84 bpm, which is why they lock together instead of drifting. The
  timer stops itself when the last rhythmic god sleeps.
- **Releases everything.** Pointer up, pointer cancel, key up, window blur, and
  `visibilitychange` all release; hiding the tab additionally suspends the
  context and hands the audio hardware back.
- **Mute** is the only non-playing control — a ramped master gain, not a
  parameter to tune.

## Accessibility

- Seven native `<button>`s with a visible focus ring and accessible names that
  contain their visible text: *"Zeus — sky and thunder. Key A."*
- **No `aria-pressed` on the totems.** They are momentary, not toggles, and
  seven buttons permanently reading `aria-pressed="false"` is worse than
  nothing — it announces a state that never means anything. Held state is
  carried by the `aria-live="polite"` inscription instead. `aria-pressed` *is*
  used on the mute button, where it genuinely applies.
- Small text clears 4.5:1. `--bronze-dim` (2.93:1) was demoted to decoration
  only; key letters use `--bronze` (5.86:1) and borders use a new `--edge`
  (4.06:1, over the 3:1 UI threshold).
- Deity and key labels get **larger** on phones, not smaller — they are read at
  arm's length. Measured 11.52px at 375px wide.
- Touch targets are generous, `touch-action` and `user-select` are locked down
  so a hold doesn't trigger text selection or a browser gesture.
- No horizontal overflow at 375, 768 or 1440px (measured 0px at all three).

## Limitations

Things that are genuinely true and worth saying out loud rather than papering
over:

1. **Real pressure is unavailable on almost every device.** The velocity
   fallback is good, but a slow deliberate press on a trackpad cannot be
   distinguished from a slow accidental one. Pen users get the real thing.
2. **Keyboard play is less expressive than pointer play**, unavoidably. Keys
   have no position, so they get a fixed y and a spread x. A keyboard-only
   player hears the pantheon but not the shaping.
3. **Ares is on a fixed pattern.** His rhythm doesn't respond to gesture beyond
   impact intensity, so he is the least "playable" of the seven. Making him
   gesture-programmable was out of scope for one revision.
4. **Everything is quantised to one 84 bpm grid.** That is what makes four
   rhythmic gods lock together instead of turning to mud, but it also means you
   cannot play against the beat — the instrument has a tempo and you don't
   choose it.
5. **The shared delay is global.** Artemis's send and Hades's release both feed
   the same line, so with both awake the tail is slightly busier than either
   alone. Damped and bounded, but not isolated per god.
6. **Relationships are binary, not continuous.** Zeus + Poseidon is either a
   storm or it isn't; there is no partial blend based on how long they have both
   been held. Continuous crossfades would be richer and were left for later.
7. **Peak level was measured in headless Chromium.** The analyser reading of
   0.540 is real and the compressor is real, but output level still depends on
   the listener's own hardware and OS mixer.
8. **The lightning and Demeter's growth use wall-clock timers**, not the audio
   clock, so they are the two things that can drift by a few milliseconds under
   heavy main-thread load. Both are deliberately non-metrical, so drift is
   inaudible — but it is drift.

## Where the code lives

| file | responsibility |
|---|---|
| `src/engine.ts` | The shared plant: context, output chain, compressor, delay, cached buffers, transport clock. Knows nothing about gods. |
| `src/gods.ts` | The seven voices. Each exposes `update(gesture)`, `setRelation(relation, amount)`, `release()` and nothing else. |
| `src/pantheon.ts` | Ref-counted holders (a god held by two fingers and a key is one voice), and the five relationships. |
| `src/inscription.ts` | Pure function: active gods → one sentence. |
| `main.ts` | DOM only — pointers, keys, the visual frame loop, mute. Hears nothing. |
