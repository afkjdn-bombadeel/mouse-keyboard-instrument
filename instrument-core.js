(function initInstrumentCore(root) {
  "use strict";

  const ROWS = [
    { id: "top", letters: "QWERTYUIOP".split(""), baseMidi: 60, y: 0.23, left: 0.075, right: 0.88 },
    { id: "home", letters: "ASDFGHJKL".split(""), baseMidi: 48, y: 0.50, left: 0.12, right: 0.85 },
    { id: "bottom", letters: "ZXCVBNM".split(""), baseMidi: 36, y: 0.75, left: 0.19, right: 0.78 }
  ];

  const SCALES = {
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    pentatonic: [0, 3, 5, 7, 10, 12, 15, 17, 19, 22],
    minor: [0, 2, 3, 5, 7, 8, 10, 12, 14, 15],
    whole: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18]
  };

  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const INSTRUMENT_KEYS = ROWS.flatMap((row) => row.letters);
  const MODIFIER_KEYS = new Set(["SHIFT", "CONTROL", "ALT"]);

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  function midiToFrequency(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function midiToName(midi) {
    const rounded = Math.round(midi);
    const note = NOTE_NAMES[((rounded % 12) + 12) % 12];
    const octave = Math.floor(rounded / 12) - 1;
    return `${note}${octave}`;
  }

  function keyMeta(letter, scaleName) {
    const upper = String(letter).toUpperCase();
    const scale = SCALES[scaleName] || SCALES.pentatonic;
    for (const row of ROWS) {
      const index = row.letters.indexOf(upper);
      if (index !== -1) {
        const midi = row.baseMidi + scale[index % scale.length];
        return {
          key: upper,
          rowId: row.id,
          rowIndex: ROWS.indexOf(row),
          index,
          midi,
          note: midiToName(midi)
        };
      }
    }
    return null;
  }

  function computeLayout(width, height, options = {}) {
    const stageWidth = Math.max(1, width);
    const stageHeight = Math.max(1, height);
    const scaleName = options.scale || "pentatonic";
    const nodes = {};
    const ordered = [];

    for (const row of ROWS) {
      const span = row.right - row.left;
      const denom = Math.max(1, row.letters.length - 1);
      row.letters.forEach((letter, index) => {
        const x = (row.left + (span * index) / denom) * stageWidth;
        const y = row.y * stageHeight;
        const meta = keyMeta(letter, scaleName);
        const node = { ...meta, x, y };
        nodes[letter] = node;
        ordered.push(node);
      });
    }

    return { nodes, ordered, width: stageWidth, height: stageHeight };
  }

  function normalizeHeldKeys(keys) {
    return Array.from(keys || [])
      .map((key) => String(key).toUpperCase())
      .filter((key) => INSTRUMENT_KEYS.includes(key))
      .filter((key, index, array) => array.indexOf(key) === index);
  }

  function makeEdge(a, b, type, index) {
    return {
      id: `${a.key}-${b.key}`,
      a: a.key,
      b: b.key,
      type,
      index
    };
  }

  function buildEdges(heldKeys, layout) {
    const nodes = heldKeys.map((key) => layout.nodes[key]).filter(Boolean);
    if (nodes.length < 2) return [];

    const sameRow = nodes.every((node) => node.rowId === nodes[0].rowId);
    if (nodes.length === 2) {
      return [makeEdge(nodes[0], nodes[1], sameRow ? "same-row-span" : "span", 0)];
    }

    if (sameRow) {
      const sorted = nodes.slice().sort((a, b) => a.x - b.x);
      return sorted.slice(0, -1).map((node, index) => makeEdge(node, sorted[index + 1], "same-row-chord", index));
    }

    const edges = [];
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        edges.push(makeEdge(nodes[i], nodes[j], "mesh", edges.length));
      }
    }
    return edges;
  }

  function projectPointToSegment(point, a, b) {
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const lenSq = vx * vx + vy * vy;
    if (lenSq === 0) {
      return { t: 0, x: a.x, y: a.y, distance: distance(point, a) };
    }
    const t = clamp(((point.x - a.x) * vx + (point.y - a.y) * vy) / lenSq, 0, 1);
    const x = a.x + vx * t;
    const y = a.y + vy * t;
    return { t, x, y, distance: Math.hypot(point.x - x, point.y - y) };
  }

  function nearestEdge(point, edges, layout) {
    let best = null;
    for (const edge of edges) {
      const a = layout.nodes[edge.a];
      const b = layout.nodes[edge.b];
      const projection = projectPointToSegment(point, a, b);
      const candidate = { edge, projection };
      if (!best || projection.distance < best.projection.distance) best = candidate;
    }
    return best;
  }

  function normalizeWeights(weights, options = {}) {
    const totals = new Map();
    for (const entry of weights) {
      if (!entry || !entry.key || entry.weight <= 0) continue;
      const existing = totals.get(entry.key);
      const role = existing && existing.role === "anchor" ? existing.role : entry.role;
      totals.set(entry.key, {
        key: entry.key,
        weight: (existing ? existing.weight : 0) + entry.weight,
        role: role || "anchor"
      });
    }
    const normalized = Array.from(totals.values());
    const total = normalized.reduce((sum, entry) => sum + entry.weight, 0) || 1;
    const anchorFloor = options.anchorFloor || 0;
    const withFloors = normalized.map((entry) => ({
      ...entry,
      weight: entry.weight / total
    }));
    const anchors = withFloors.filter((entry) => entry.role === "anchor");
    const floored = anchorFloor > 0 && anchors.length > 1
      ? withFloors.map((entry) => ({
        ...entry,
        weight: entry.role === "anchor" ? Math.max(anchorFloor, entry.weight) : entry.weight
      }))
      : withFloors;
    const flooredTotal = floored.reduce((sum, entry) => sum + entry.weight, 0) || 1;
    return floored
      .map((entry) => ({ ...entry, weight: entry.weight / flooredTotal }))
      .filter((entry) => entry.weight >= 0.015)
      .sort((a, b) => b.weight - a.weight);
  }

  function sameRowSpanResonance(a, b, t) {
    if (a.rowId !== b.rowId) return [];
    const row = ROWS[a.rowIndex];
    const minIndex = Math.min(a.index, b.index);
    const maxIndex = Math.max(a.index, b.index);
    const start = a.index;
    const end = b.index;
    const virtualIndex = start + (end - start) * t;
    const span = Math.max(1, Math.abs(end - start));
    const sigma = Math.max(0.55, span / 3);
    const weights = [];

    for (let index = minIndex; index <= maxIndex; index += 1) {
      const key = row.letters[index];
      if (key === a.key || key === b.key) continue;
      const normalizedDistance = (index - virtualIndex) / sigma;
      const weight = 0.16 * Math.exp(-0.5 * normalizedDistance * normalizedDistance);
      weights.push({ key, weight, role: "resonance" });
    }
    return weights;
  }

  function inverseDistanceWeights(point, nodes) {
    return nodes.map((node) => {
      const d = Math.max(12, distance(point, node));
      return { key: node.key, weight: 1 / (d * d), role: "anchor" };
    });
  }

  function rowChordWeights(point, nodes) {
    const raw = inverseDistanceWeights(point, nodes);
    const max = raw.reduce((value, entry) => Math.max(value, entry.weight), 0) || 1;
    return raw.map((entry) => ({
      ...entry,
      weight: 0.22 + 0.78 * (entry.weight / max)
    }));
  }

  function computeWeights(heldKeys, layout, cursor, edges) {
    const nodes = heldKeys.map((key) => layout.nodes[key]).filter(Boolean);
    if (nodes.length === 0) {
      return { weights: [], activeEdge: null, mode: "idle", relation: "none" };
    }
    if (nodes.length === 1) {
      return {
        weights: [{ key: nodes[0].key, weight: 1, role: "anchor" }],
        activeEdge: null,
        mode: "single",
        relation: nodes[0].key
      };
    }

    const sameRow = nodes.every((node) => node.rowId === nodes[0].rowId);
    const nearest = nearestEdge(cursor, edges, layout);
    if (nodes.length === 2 && nearest) {
      const a = layout.nodes[nearest.edge.a];
      const b = layout.nodes[nearest.edge.b];
      const t = nearest.projection.t;
      const weights = [
        { key: a.key, weight: Math.max(0.001, 1 - t), role: "anchor" },
        { key: b.key, weight: Math.max(0.001, t), role: "anchor" },
        ...sameRowSpanResonance(a, b, t)
      ];
      return {
        weights: normalizeWeights(weights, { anchorFloor: 0.08 }),
        activeEdge: { ...nearest, a, b },
        mode: sameRow ? "span" : "bridge",
        relation: `${a.key}-${b.key}`
      };
    }

    if (sameRow) {
      const sorted = nodes.slice().sort((a, b) => a.x - b.x);
      const weights = rowChordWeights(cursor, sorted);
      return {
        weights: normalizeWeights(weights, { anchorFloor: 0.08 }),
        activeEdge: nearest ? { ...nearest, a: layout.nodes[nearest.edge.a], b: layout.nodes[nearest.edge.b] } : null,
        mode: "row-chord",
        relation: sorted.map((node) => node.key).join("-")
      };
    }

    if (nearest && nearest.projection.distance < Math.max(38, layout.height * 0.07)) {
      const a = layout.nodes[nearest.edge.a];
      const b = layout.nodes[nearest.edge.b];
      const t = nearest.projection.t;
      return {
        weights: normalizeWeights([
          { key: a.key, weight: Math.max(0.001, 1 - t), role: "anchor" },
          { key: b.key, weight: Math.max(0.001, t), role: "anchor" }
        ], { anchorFloor: 0.08 }),
        activeEdge: { ...nearest, a, b },
        mode: "mesh-edge",
        relation: `${a.key}-${b.key}`
      };
    }

    return {
      weights: normalizeWeights(inverseDistanceWeights(cursor, nodes), { anchorFloor: 0.08 }),
      activeEdge: nearest ? { ...nearest, a: layout.nodes[nearest.edge.a], b: layout.nodes[nearest.edge.b] } : null,
      mode: "mesh-field",
      relation: nodes.map((node) => node.key).join("-")
    };
  }

  function activeModifierEffects(modifiers, modifierMap) {
    const effects = [];
    if (modifiers.shift) effects.push({ key: "shift", effect: modifierMap.shift });
    if (modifiers.control) effects.push({ key: "control", effect: modifierMap.control });
    if (modifiers.alt) effects.push({ key: "alt", effect: modifierMap.alt });
    return effects.filter((entry) => entry.effect);
  }

  function modifierGainScale(effects) {
    return effects.some((entry) => entry.effect === "dampen") ? 0.45 : 1;
  }

  function noteEntriesFromWeights(weights, options) {
    const scaleName = options.scale || "pentatonic";
    const verticalSemis = options.verticalSemis || 0;
    const bendSemis = options.bendSemis || 0;
    const effects = options.effects || [];
    const gainScale = modifierGainScale(effects);
    const entries = [];

    for (const weight of weights) {
      const meta = keyMeta(weight.key, scaleName);
      if (!meta) continue;
      const baseMidi = meta.midi + verticalSemis + bendSemis;
      const baseGain = weight.weight * (weight.role === "resonance" ? 0.34 : 1) * gainScale;
      entries.push({
        key: weight.key,
        label: `${weight.key}:${weight.role || "anchor"}`,
        note: midiToName(baseMidi),
        midi: baseMidi,
        frequency: midiToFrequency(baseMidi),
        weight: baseGain,
        role: weight.role || "anchor"
      });

      for (const mod of effects) {
        let harmony = null;
        if (mod.effect === "octave-up") harmony = { semis: 12, amount: 0.34, suffix: "+8" };
        if (mod.effect === "octave-down") harmony = { semis: -12, amount: 0.30, suffix: "-8" };
        if (mod.effect === "fifth") harmony = { semis: 7, amount: 0.28, suffix: "+5" };
        if (!harmony) continue;
        const midi = baseMidi + harmony.semis;
        entries.push({
          key: weight.key,
          label: `${weight.key}:${mod.key}:${harmony.suffix}`,
          note: midiToName(midi),
          midi,
          frequency: midiToFrequency(midi),
          weight: baseGain * harmony.amount,
          role: mod.effect
        });
      }
    }

    return entries.sort((a, b) => b.weight - a.weight);
  }

  function computeBend(pointer, layout, config) {
    if (!pointer || !pointer.leftActive || !pointer.leftOrigin) {
      return { x: 0, y: 0, total: 0, dx: 0, dy: 0 };
    }
    const response = (config.bendResponse || 55) / 100;
    const range = config.bendRange || 12;
    const dx = pointer.cursor.x - pointer.leftOrigin.x;
    const dy = pointer.cursor.y - pointer.leftOrigin.y;
    const bendX = (dx / Math.max(1, layout.width * 0.35)) * range * response;
    const bendY = (-dy / Math.max(1, layout.height * 0.35)) * range * response;
    return {
      x: clamp(bendX, -range, range),
      y: clamp(bendY, -range, range),
      total: clamp(bendX + bendY, -range, range),
      dx,
      dy
    };
  }

  function scrollSpeedFromDelta(deltaY, elapsed, options = {}) {
    const delta = Math.abs(deltaY || 0);
    const elapsedMs = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : null;
    const minElapsed = options.minElapsed || 18;
    const speedScale = options.speedScale || 3.2;
    const wheelScale = options.wheelScale || 120;
    const distanceSpeed = delta / wheelScale;
    const velocitySpeed = elapsedMs ? (delta / Math.max(minElapsed, elapsedMs)) / speedScale : 0;
    const rawSpeed = clamp(Math.max(distanceSpeed, velocitySpeed), 0, 1);
    return clamp(Math.pow(rawSpeed, 0.52), 0, 1);
  }

  function computeBowTimbre(options = {}) {
    const direction = options.direction < 0 ? -1 : options.direction > 0 ? 1 : 0;
    const bowPosition = clamp(Number.isFinite(options.bowPosition) ? options.bowPosition : 0.5, 0, 1);
    const bowSpeed = clamp(Number.isFinite(options.bowSpeed) ? options.bowSpeed : 0, 0, 1);
    const endTension = Math.pow(Math.abs(bowPosition - 0.5) * 2, 1.2);
    const middleWarmth = Math.sin(bowPosition * Math.PI);
    const rosin = Math.sin(bowPosition * Math.PI * 4) * 0.5 + 0.5;
    const attack = clamp(Math.pow(bowSpeed, 0.5) * (0.72 + endTension * 0.45), 0, 1);
    const pressure = clamp(0.18 + bowSpeed * 0.78, 0, 1);
    const directionBrightness = direction * (0.045 + bowSpeed * 0.045);

    return {
      direction,
      bowPosition,
      bowSpeed,
      endTension,
      middleWarmth,
      rosin,
      attack,
      pressure,
      frequencySkew: direction * (0.00035 + pressure * 0.0009 + endTension * 0.00055),
      filterMultiplier: clamp(0.92 + pressure * 0.06 + directionBrightness * 0.55 + endTension * 0.07 - middleWarmth * 0.03, 0.78, 1.14),
      brightnessHz: endTension * 240 + attack * 260 + pressure * 220 + rosin * 80 - middleWarmth * 90,
      overtoneScale: clamp(0.86 + direction * 0.025 + attack * 0.08 + pressure * 0.08 + endTension * 0.05, 0.74, 1.18),
      gainScale: clamp(0.72 + pressure * 0.32 + endTension * 0.22 + middleWarmth * 0.08 + attack * 0.22, 0.58, 1.58),
      attackTime: clamp(0.16 - attack * 0.12, 0.028, 0.16),
      bowFlutterDepth: clamp(pressure * 0.00045 + attack * 0.00035, 0, 0.0008),
      bowFlutterRate: 36 + pressure * 24
    };
  }

  function classifyScrollGesture(previous, current) {
    const lastDirection = previous && previous.lastDirection ? previous.lastDirection : 0;
    const lastAt = previous && Number.isFinite(previous.lastAt) ? previous.lastAt : -Infinity;
    const direction = current.deltaY < 0 ? -1 : 1;
    const now = Number.isFinite(current.now) ? current.now : 0;
    const continuationMs = current.continuationMs || 1000;
    const strokeSteps = current.strokeSteps || 30;
    const previousPosition = previous && Number.isFinite(previous.bowPosition) ? previous.bowPosition : 0.5;
    const elapsed = now - lastAt;
    const isContinuation = lastDirection === direction && elapsed >= 0 && elapsed <= continuationMs;
    const speed = scrollSpeedFromDelta(current.deltaY, elapsed, current);
    const rawBowPosition = clamp(previousPosition + direction / strokeSteps, 0, 1);
    const bowPosition = rawBowPosition <= 0.000001 ? 0 : rawBowPosition >= 0.999999 ? 1 : rawBowPosition;
    const timbre = computeBowTimbre({ direction, bowPosition, bowSpeed: speed });
    return {
      direction,
      gesture: isContinuation ? "bow" : "pluck",
      elapsed,
      isContinuation,
      speed,
      bowSpeed: speed,
      bowPosition,
      bowAttack: timbre.attack,
      strokeSteps,
      strokeIndex: Math.round(bowPosition * strokeSteps),
      timbre
    };
  }

  function computeModel(input) {
    const config = input.config || {};
    const layout = input.layout;
    const cursor = {
      x: clamp(input.cursor.x, 0, layout.width),
      y: clamp(input.cursor.y, 0, layout.height)
    };
    const heldKeys = normalizeHeldKeys(input.heldKeys);
    const edges = buildEdges(heldKeys, layout);
    const pitchRange = config.pitchRange || 12;
    const yNorm = clamp(cursor.y / Math.max(1, layout.height), 0, 1);
    const xNorm = clamp(cursor.x / Math.max(1, layout.width), 0, 1);
    const verticalSemis = (0.5 - yNorm) * pitchRange * 2;
    const modifierMap = config.modifierMap || { shift: "octave-up", control: "filter", alt: "fifth" };
    const modifiers = input.modifiers || {};
    const effects = activeModifierEffects(modifiers, modifierMap);
    const bend = computeBend({ ...input.pointer, cursor }, layout, config);
    const weightModel = computeWeights(heldKeys, layout, cursor, edges);
    const notes = noteEntriesFromWeights(weightModel.weights, {
      scale: config.scale || "pentatonic",
      verticalSemis,
      bendSemis: input.ignoreBend ? 0 : bend.total,
      effects
    });

    return {
      heldKeys,
      cursor: { ...cursor, xNorm, yNorm },
      edges,
      weights: weightModel.weights,
      notes,
      activeEdge: weightModel.activeEdge,
      mode: weightModel.mode,
      relation: weightModel.relation,
      verticalSemis,
      bend,
      effects
    };
  }

  function formatNotes(notes, limit = 6) {
    if (!notes || notes.length === 0) return "silent";
    return notes.slice(0, limit).map((note) => `${note.key}${note.note} ${(note.weight * 100).toFixed(0)}%`).join("  ");
  }

  const api = {
    ROWS,
    SCALES,
    INSTRUMENT_KEYS,
    MODIFIER_KEYS,
    clamp,
    distance,
    midiToFrequency,
    midiToName,
    keyMeta,
    computeLayout,
    normalizeHeldKeys,
    buildEdges,
    projectPointToSegment,
    nearestEdge,
    scrollSpeedFromDelta,
    computeBowTimbre,
    classifyScrollGesture,
    computeModel,
    formatNotes
  };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.MKICore = api;
})(typeof window !== "undefined" ? window : globalThis);
