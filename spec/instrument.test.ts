import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// Turns the mechanically-checkable lines of C4's published spec
// (https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/crits/04-instrument/)
// into tests against the built site. The rest of the spec --- whether it's
// expressive, whether two players sound different, whether it's fun to play
// wrong --- is judged at the crit, not here.

const distPath = resolve("dist/index.html");

describe("an instrument", () => {
  it("built the page", () => {
    expect(existsSync(distPath), `${distPath} not found — run pnpm build first`).toBe(true);
  });

  const doc = new JSDOM(readFileSync(distPath, "utf8")).window.document;

  it("makes sound live, rather than shipping a recording", () => {
    // "the browser is the instrument --- sound is made live in the page by
    // the player, not played back". A shipped <audio>/<video> element is the
    // opposite of that: something pre-recorded, not synthesised on the fly.
    expect(doc.querySelectorAll("audio, video").length).toBe(0);
  });

  it("marks the opening invitation to play", () => {
    // "a stranger can play it uninstructed --- the opening screen invites the
    // first sound". [data-start] is the contract: whatever the instrument
    // turns out to be, something on the opening screen carries this
    // attribute and has real, visible copy inviting the first interaction.
    const start = doc.querySelector("[data-start]");
    expect(start, "no [data-start] element --- see spec/README.md").toBeTruthy();
    expect(start?.textContent?.trim(), "[data-start] has no visible copy").not.toBe("");
  });

  it("gives its controls to real, focusable elements", () => {
    // "playable with whatever is at hand --- mouse, keyboard or touch". A
    // <button> or <input> gets keyboard and touch handling for free; a <div
    // onclick> gets neither. At least one real control must exist once the
    // instrument is built.
    const controls = doc.querySelectorAll("button, input");
    expect(controls.length, "no <button> or <input> controls found").toBeGreaterThan(0);
    for (const control of controls) {
      expect(
        control.getAttribute("tabindex"),
        `${control.outerHTML} is a real control --- don't remove it from the tab order`,
      ).not.toBe("-1");
    }
  });
});
