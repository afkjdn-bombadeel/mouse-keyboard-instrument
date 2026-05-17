import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const Core = require("../instrument-core.js");

const layout = Core.computeLayout(1000, 620, {
  scale: "pentatonic"
});

function model(overrides = {}) {
  return Core.computeModel({
    layout,
    cursor: overrides.cursor || { x: 500, y: 310 },
    heldKeys: overrides.heldKeys || [],
    modifiers: overrides.modifiers || { shift: false, control: false, alt: false },
    pointer: overrides.pointer || { leftActive: false, leftOrigin: null, cursor: overrides.cursor || { x: 500, y: 310 } },
    config: {
      scale: "pentatonic",
      pitchRange: 12,
      bendRange: 12,
      bendResponse: 55,
      modifierMap: { shift: "octave-up", control: "filter", alt: "fifth" }
    }
  });
}

{
  const q = model({ heldKeys: ["Q"] });
  assert.equal(q.mode, "single");
  assert.equal(q.notes[0].key, "Q");
  assert.equal(q.edges.length, 0);
}

{
  const qo = model({ heldKeys: ["Q", "O"], cursor: { x: 500, y: layout.nodes.Q.y } });
  assert.equal(qo.mode, "span");
  assert.equal(qo.edges.length, 1);
  assert.ok(qo.weights.some((entry) => entry.key === "Q"));
  assert.ok(qo.weights.some((entry) => entry.key === "O"));
  assert.ok(qo.weights.some((entry) => entry.role === "resonance"), "same-row spans add quiet in-between resonance");
}

{
  const qto = model({ heldKeys: ["Q", "T", "O"], cursor: { x: layout.nodes.T.x, y: layout.nodes.T.y } });
  assert.equal(qto.mode, "row-chord");
  assert.equal(qto.edges.length, 2);
  assert.deepEqual(qto.weights.map((entry) => entry.key).sort(), ["O", "Q", "T"]);
}

{
  const mesh = model({ heldKeys: ["Q", "G", "X"], cursor: { x: 450, y: 330 } });
  assert.equal(mesh.edges.length, 3);
  assert.ok(["mesh-edge", "mesh-field"].includes(mesh.mode));
  assert.ok(mesh.weights.length >= 2);
}

{
  const edge = model({ heldKeys: ["A", "K"], cursor: { x: 1000, y: layout.nodes.K.y } });
  const a = edge.weights.find((entry) => entry.key === "A");
  const k = edge.weights.find((entry) => entry.key === "K");
  assert.ok(a && a.weight >= 0.06, "the far anchor remains present in a two-key chord");
  assert.ok(k && k.weight > a.weight, "cursor-side anchor is still more prominent");
}

{
  const high = model({ heldKeys: ["Q"], cursor: { x: 500, y: 0 } });
  const low = model({ heldKeys: ["Q"], cursor: { x: 500, y: 620 } });
  assert.ok(high.notes[0].frequency > low.notes[0].frequency, "vertical cursor position controls pitch");
}

{
  const bent = model({
    heldKeys: ["Q"],
    cursor: { x: 700, y: 210 },
    pointer: { leftActive: true, leftOrigin: { x: 500, y: 310 }, cursor: { x: 700, y: 210 } }
  });
  assert.notEqual(bent.bend.total, 0);
}

{
  const shifted = model({ heldKeys: ["Q"], modifiers: { shift: true, control: false, alt: false } });
  assert.ok(shifted.effects.some((entry) => entry.effect === "octave-up"));
  assert.ok(shifted.notes.some((note) => note.role === "octave-up"));
}

{
  const first = Core.classifyScrollGesture({ lastDirection: 0, lastAt: -Infinity }, { deltaY: -100, now: 1000 });
  assert.equal(first.gesture, "pluck", "a single wheel tick is a pluck");

  const continued = Core.classifyScrollGesture({ lastDirection: -1, lastAt: 1000 }, { deltaY: -80, now: 1120 });
  assert.equal(continued.gesture, "bow", "rapid same-direction scroll sustains as bowing");
  assert.ok(continued.bowSpeed > 0, "scroll gestures report bow speed");
  assert.equal(continued.strokeSteps, 30, "the modeled bow stroke is 30 scroll steps long");

  const slowContinuation = Core.classifyScrollGesture({ lastDirection: -1, lastAt: 1000 }, { deltaY: -18, now: 1950 });
  assert.equal(slowContinuation.gesture, "bow", "same-direction scrolls up to 1 second apart stay one continuous bow");

  const alternated = Core.classifyScrollGesture({ lastDirection: -1, lastAt: 1120 }, { deltaY: 80, now: 1190 });
  assert.equal(alternated.gesture, "pluck", "quick direction changes articulate guitar-style alternating picks");

  const slowSameDirection = Core.classifyScrollGesture({ lastDirection: 1, lastAt: 1190 }, { deltaY: 80, now: 1600 });
  assert.equal(slowSameDirection.gesture, "bow", "slow same-direction scrolling within the cutoff remains continuous");

  const restarted = Core.classifyScrollGesture({ lastDirection: 1, lastAt: 1190 }, { deltaY: 80, now: 2250 });
  assert.equal(restarted.gesture, "pluck", "a same-direction scroll after more than 1 second starts a fresh bow");

  const slow = Core.classifyScrollGesture({ lastDirection: 1, lastAt: 2000, bowPosition: 0.5 }, { deltaY: 18, now: 2250 });
  const fast = Core.classifyScrollGesture({ lastDirection: 1, lastAt: 2000, bowPosition: 0.5 }, { deltaY: 180, now: 2025 });
  assert.ok(fast.bowSpeed > slow.bowSpeed, "faster wheel movement produces higher bow speed");
  assert.ok(fast.bowAttack > slow.bowAttack, "faster wheel movement produces stronger bow attack");
  assert.ok(fast.bowAttack - slow.bowAttack > 0.18, "normal slow/fast scrolls produce a musically obvious attack spread");
  assert.ok(fast.timbre.brightnessHz - slow.timbre.brightnessHz > 180, "normal slow/fast scrolls produce a clear brightness spread");
  assert.ok(fast.timbre.attackTime < slow.timbre.attackTime, "fast bowing opens the active string voice more quickly");
  assert.ok(fast.timbre.gainScale > slow.timbre.gainScale, "fast bowing increases the active string voice intensity");
  assert.ok(fast.timbre.pressure - slow.timbre.pressure > 0.3, "fast bowing produces clearly higher string pressure");
  assert.ok(fast.timbre.bowFlutterDepth > slow.timbre.bowFlutterDepth, "fast bowing increases note-internal bow flutter");

  let bow = { lastDirection: 1, lastAt: 3000, bowPosition: 0 };
  for (let index = 0; index < 30; index += 1) {
    bow = Core.classifyScrollGesture(bow, { deltaY: 80, now: 3020 + index * 20 });
  }
  assert.equal(bow.bowPosition, 1, "thirty downward scroll events consume the bow length");

  const upTone = Core.computeBowTimbre({ direction: -1, bowPosition: 0.5, bowSpeed: 0.7 });
  const downTone = Core.computeBowTimbre({ direction: 1, bowPosition: 0.5, bowSpeed: 0.7 });
  assert.notEqual(upTone.frequencySkew, downTone.frequencySkew, "up and down strokes use different pitch scrape");
  assert.notEqual(upTone.filterMultiplier, downTone.filterMultiplier, "up and down strokes use different brightness");
}

console.log("instrument core tests passed");
