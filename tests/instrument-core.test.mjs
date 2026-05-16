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

console.log("instrument core tests passed");
