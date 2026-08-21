# Process overview

## What I built

**Pantheon** is a browser instrument where seven Greek gods are seven
synthesised voices. Press a totem and it sounds; hold it and it keeps
developing — Hades sinks, Demeter's phrase grows a note every two bars, Zeus's
storm keeps cracking. Pointer position shapes it continuously: up is brighter,
sideways is stereo, speed is attack and roughness. Gods change each other when
they overlap — Zeus and Poseidon become a thunderstorm, Apollo and Artemis
trade an octave call-and-response. No settings and no score. The test I held it
to: with the names and carvings hidden, the behaviour alone should still
suggest storms, oceans, depth, growth, sunlight, hunting and war.

## The moments that mattered

**A glow that outlived its sound.** I had a check that Hades' stone stays lit
exactly as long as he is audible, and it failed — still 19% lit 4.6 s after
silence. The obvious fix was to nudge the decay constant until the assertion
went green. Instead I deleted the hand-picked constants, made each voice
declare its real audible tail, and derived the rate from that
(`Math.log(100) / tail`), so the picture and the sound can't drift apart again.
The general rule went into `CLAUDE.md`, so the next constant picked by eye gets
caught earlier.
[`6832d8e...1e1d893`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-AaronJin0323/compare/6832d8e...1e1d893)

**Green suite, silent stone.** Forty-odd Playwright checks passed at three
viewports and Artemis still made no sound on a quick tap — only playing it
found that. The agent said all four rhythmic gods were affected and began
fixing them. I had already tested Ares and it was fine, so I stopped it and
made it explain the difference: Artemis is the only god with no slot on step 0,
so she alone is always 0.42 s late. One god changed instead of four.
[`fbc41f6`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-AaronJin0323/commit/fbc41f6)
