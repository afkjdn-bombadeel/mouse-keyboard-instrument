(function initInstrumentApp() {
  "use strict";

  const Core = window.MKICore;
  const stage = document.getElementById("stage");
  const canvas = document.getElementById("stageCanvas");
  const ctx = canvas.getContext("2d");
  const keyLayer = document.getElementById("keyLayer");
  const cursorProbe = document.getElementById("cursorProbe");
  const armAudioButton = document.getElementById("armAudio");
  const audioStatus = document.getElementById("audioStatus");
  const debugHeld = document.getElementById("debugHeld");
  const debugCursor = document.getElementById("debugCursor");
  const debugNotes = document.getElementById("debugNotes");
  const debugState = document.getElementById("debugState");
  const debugLog = document.getElementById("debugLog");

  const controls = {
    shiftEffect: document.getElementById("shiftEffect"),
    controlEffect: document.getElementById("controlEffect"),
    altEffect: document.getElementById("altEffect"),
    scaleSelect: document.getElementById("scaleSelect"),
    pitchRange: document.getElementById("pitchRange"),
    bendRange: document.getElementById("bendRange"),
    bendResponse: document.getElementById("bendResponse"),
    releaseTime: document.getElementById("releaseTime"),
    keybedTone: document.getElementById("keybedTone"),
    rightHumFollowsBend: document.getElementById("rightHumFollowsBend"),
    showWaves: document.getElementById("showWaves"),
    showInactive: document.getElementById("showInactive"),
    latchKeys: document.getElementById("latchKeys"),
    glowIntensity: document.getElementById("glowIntensity")
  };

  const outputs = {
    pitchRange: document.getElementById("pitchRangeOut"),
    bendRange: document.getElementById("bendRangeOut"),
    bendResponse: document.getElementById("bendResponseOut"),
    releaseTime: document.getElementById("releaseTimeOut"),
    glowIntensity: document.getElementById("glowIntensityOut")
  };

  const config = {
    scale: "pentatonic",
    pitchRange: 12,
    bendRange: 12,
    bendResponse: 55,
    releaseTime: 1.4,
    keybedTone: true,
    rightHumFollowsBend: false,
    showWaves: true,
    showInactive: true,
    latchKeys: false,
    glowIntensity: 62,
    modifierMap: {
      shift: "octave-up",
      control: "filter",
      alt: "fifth"
    }
  };

  const state = {
    layout: Core.computeLayout(1, 1, config),
    keysDown: new Set(),
    latchedKeys: new Set(),
    testKeys: new Set(),
    modifiers: { shift: false, control: false, alt: false },
    cursor: { x: 0, y: 0 },
    left: { active: false, origin: null, model: null },
    right: { active: false, origin: null, model: null },
    scroll: { bowUntil: 0, lastDirection: 0, count: 0 },
    waves: [],
    log: [],
    lastModel: null,
    lastPluckModel: null,
    lastPointerDownAt: 0,
    lastPointerUpAt: 0
  };

  const keyElements = new Map();

  class AudioEngine {
    constructor() {
      this.context = null;
      this.master = null;
      this.delay = null;
      this.delayGain = null;
      this.compressor = null;
      this.banks = {
        keybed: new Map(),
        left: new Map(),
        right: new Map(),
        bow: new Map()
      };
    }

    async ensure() {
      if (!this.context) this.createGraph();
      if (this.context.state !== "running") await this.context.resume();
      setAudioStatus("armed");
      return this.context;
    }

    createGraph() {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = 0.42;
      this.compressor = this.context.createDynamicsCompressor();
      this.compressor.threshold.value = -18;
      this.compressor.knee.value = 20;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.008;
      this.compressor.release.value = 0.16;
      this.delay = this.context.createDelay(1.2);
      this.delay.delayTime.value = 0.18;
      this.delayGain = this.context.createGain();
      this.delayGain.gain.value = 0.04;
      this.delay.connect(this.delayGain);
      this.delayGain.connect(this.compressor);
      this.master.connect(this.compressor);
      this.compressor.connect(this.context.destination);
    }

    setGlobalEffects(model) {
      if (!this.context || !this.delayGain) return;
      const now = this.context.currentTime;
      const effects = model.effects.map((effect) => effect.effect);
      const delayAmount = effects.includes("delay") ? 0.22 : 0.04;
      this.delayGain.gain.setTargetAtTime(delayAmount, now, 0.08);
    }

    createVoice(note, channel) {
      const now = this.context.currentTime;
      const osc = this.context.createOscillator();
      const overtone = this.context.createOscillator();
      const gain = this.context.createGain();
      const overtoneGain = this.context.createGain();
      const filter = this.context.createBiquadFilter();
      osc.type = channel === "bow" ? "triangle" : "sine";
      overtone.type = "triangle";
      osc.frequency.value = note.frequency;
      overtone.frequency.value = note.frequency * 2;
      gain.gain.value = 0.0001;
      overtoneGain.gain.value = 0.045;
      filter.type = "lowpass";
      filter.frequency.value = 2200;
      filter.Q.value = 0.8;
      osc.connect(filter);
      overtone.connect(overtoneGain);
      overtoneGain.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      gain.connect(this.delay);
      osc.start(now);
      overtone.start(now);
      return { osc, overtone, gain, overtoneGain, filter, touched: performance.now() };
    }

    setContinuous(channel, notes, options = {}) {
      if (!this.context) return;
      const bank = this.banks[channel];
      const now = this.context.currentTime;
      const liveKeys = new Set();
      const level = options.level || 1;
      const effects = options.effects || [];
      const filterActive = effects.some((entry) => entry.effect === "filter");
      const tremoloActive = effects.some((entry) => entry.effect === "tremolo");
      const filterBase = filterActive ? 900 + (1 - (state.lastModel ? state.lastModel.cursor.yNorm : 0.5)) * 4200 : 2400;
      const tremolo = tremoloActive ? 0.72 + Math.sin(performance.now() / 72) * 0.18 : 1;

      notes.slice(0, 10).forEach((note, index) => {
        const id = `${note.label}:${index}`;
        liveKeys.add(id);
        let voice = bank.get(id);
        if (!voice) {
          voice = this.createVoice(note, channel);
          bank.set(id, voice);
        }
        voice.touched = performance.now();
        voice.osc.frequency.setTargetAtTime(note.frequency, now, 0.025);
        voice.overtone.frequency.setTargetAtTime(note.frequency * 2, now, 0.025);
        voice.filter.frequency.setTargetAtTime(filterBase + note.weight * 1200, now, 0.06);
        const gainTarget = Math.min(0.16, note.weight * 0.115 * level * tremolo);
        voice.gain.gain.setTargetAtTime(gainTarget, now, 0.035);
      });

      for (const [id, voice] of bank) {
        if (liveKeys.has(id)) continue;
        voice.gain.gain.setTargetAtTime(0.0001, now, Math.max(0.06, config.releaseTime * 0.22));
        const stopAt = now + Math.max(0.12, config.releaseTime);
        window.setTimeout(() => {
          try {
            voice.osc.stop(stopAt);
            voice.overtone.stop(stopAt);
          } catch (_error) {
            // The oscillator may already be stopped after rapid state changes.
          }
        }, Math.max(120, config.releaseTime * 1000));
        bank.delete(id);
      }
    }

    stopContinuous(channel) {
      this.setContinuous(channel, []);
    }

    pluck(notes, energy = 1, effects = []) {
      if (!this.context || notes.length === 0) return;
      const now = this.context.currentTime;
      const delayActive = effects.some((entry) => entry.effect === "delay");
      notes.slice(0, 8).forEach((note) => {
        const osc = this.context.createOscillator();
        const gain = this.context.createGain();
        const filter = this.context.createBiquadFilter();
        osc.type = note.role === "resonance" ? "triangle" : "sine";
        osc.frequency.value = note.frequency;
        filter.type = "bandpass";
        filter.frequency.value = note.frequency * 2.5;
        filter.Q.value = 2.6;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.003, note.weight * 0.22 * energy), now + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + (delayActive ? 1.1 : 0.7));
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.master);
        gain.connect(this.delay);
        osc.start(now);
        osc.stop(now + 1.25);
      });
    }
  }

  const audio = new AudioEngine();

  function setAudioStatus(status) {
    audioStatus.dataset.state = status;
    audioStatus.textContent = status;
    armAudioButton.textContent = status === "armed" ? "Audio Armed" : "Arm Audio";
  }

  function heldKeys() {
    return Array.from(new Set([...state.keysDown, ...state.latchedKeys, ...state.testKeys]))
      .filter((key) => Core.INSTRUMENT_KEYS.includes(key))
      .sort((a, b) => Core.INSTRUMENT_KEYS.indexOf(a) - Core.INSTRUMENT_KEYS.indexOf(b));
  }

  function pointerInput(ignoreBend = false, cursor = state.cursor) {
    return {
      layout: state.layout,
      cursor,
      heldKeys: heldKeys(),
      modifiers: state.modifiers,
      pointer: {
        leftActive: state.left.active,
        leftOrigin: state.left.origin,
        cursor
      },
      ignoreBend,
      config
    };
  }

  function currentModel(cursor = state.cursor, ignoreBend = false) {
    return Core.computeModel(pointerInput(ignoreBend, cursor));
  }

  function modelForAnchor(anchor, allowBend) {
    if (!anchor) return null;
    return Core.computeModel({
      layout: state.layout,
      cursor: anchor,
      heldKeys: heldKeys(),
      modifiers: state.modifiers,
      pointer: {
        leftActive: allowBend && state.left.active,
        leftOrigin: state.left.origin,
        cursor: state.cursor
      },
      ignoreBend: !allowBend,
      config
    });
  }

  function updateOutputs() {
    outputs.pitchRange.textContent = `+/-${config.pitchRange} st`;
    outputs.bendRange.textContent = `+/-${config.bendRange} st`;
    outputs.bendResponse.textContent = `${config.bendResponse}%`;
    outputs.releaseTime.textContent = `${config.releaseTime.toFixed(1)}s`;
    outputs.glowIntensity.textContent = `${config.glowIntensity}%`;
  }

  function syncConfigFromControls() {
    config.scale = controls.scaleSelect.value;
    config.pitchRange = Number(controls.pitchRange.value);
    config.bendRange = Number(controls.bendRange.value);
    config.bendResponse = Number(controls.bendResponse.value);
    config.releaseTime = Number(controls.releaseTime.value);
    config.keybedTone = controls.keybedTone.checked;
    config.rightHumFollowsBend = controls.rightHumFollowsBend.checked;
    config.showWaves = controls.showWaves.checked;
    config.showInactive = controls.showInactive.checked;
    config.latchKeys = controls.latchKeys.checked;
    config.glowIntensity = Number(controls.glowIntensity.value);
    config.modifierMap.shift = controls.shiftEffect.value;
    config.modifierMap.control = controls.controlEffect.value;
    config.modifierMap.alt = controls.altEffect.value;
    updateOutputs();
    layoutStage();
    logEvent("config");
  }

  function layoutStage() {
    const rect = stage.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * scale));
    canvas.height = Math.max(1, Math.round(rect.height * scale));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    state.layout = Core.computeLayout(rect.width, rect.height, config);
    if (!state.cursor.x && !state.cursor.y) {
      state.cursor = { x: rect.width * 0.5, y: rect.height * 0.52 };
    }
    renderKeyNodes();
  }

  function renderKeyNodes() {
    for (const node of state.layout.ordered) {
      let element = keyElements.get(node.key);
      if (!element) {
        element = document.createElement("button");
        element.type = "button";
        element.className = "key-node";
        element.dataset.key = node.key;
        element.setAttribute("aria-label", `${node.key} ${node.note}`);
        element.innerHTML = `<span>${node.key}</span><small>${node.note}</small>`;
        element.addEventListener("pointerdown", (event) => {
          if (!config.latchKeys) return;
          event.preventDefault();
          event.stopPropagation();
        });
        element.addEventListener("pointerup", (event) => {
          if (!config.latchKeys) return;
          event.preventDefault();
          event.stopPropagation();
        });
        element.addEventListener("click", (event) => {
          if (!config.latchKeys) return;
          event.preventDefault();
          toggleLatchedKey(node.key);
        });
        keyLayer.appendChild(element);
        keyElements.set(node.key, element);
      }
      element.style.left = `${node.x}px`;
      element.style.top = `${node.y}px`;
      element.style.display = config.showInactive || heldKeys().includes(node.key) ? "grid" : "none";
      element.querySelector("small").textContent = node.note;
      element.setAttribute("aria-label", `${node.key} ${node.note}`);
    }
  }

  function toggleLatchedKey(key) {
    if (state.latchedKeys.has(key)) state.latchedKeys.delete(key);
    else state.latchedKeys.add(key);
    logEvent("latch");
  }

  function stagePointFromEvent(event) {
    const rect = stage.getBoundingClientRect();
    return {
      x: Core.clamp(event.clientX - rect.left, 0, rect.width),
      y: Core.clamp(event.clientY - rect.top, 0, rect.height)
    };
  }

  function logEvent(type, extra = "") {
    const model = currentModel();
    const held = heldKeys().join(",") || "none";
    const notes = Core.formatNotes(model.notes, 5);
    const entry = {
      time: new Date().toLocaleTimeString([], { hour12: false }),
      type,
      text: `${type}${extra ? ` ${extra}` : ""} | keys ${held} | cursor ${Math.round(model.cursor.x)},${Math.round(model.cursor.y)} | ${model.mode} ${model.relation} | ${notes}`
    };
    state.log.unshift(entry);
    state.log = state.log.slice(0, 7);
    renderDebug(model);
  }

  function renderDebug(model) {
    debugHeld.textContent = heldKeys().join(", ") || "none";
    debugCursor.textContent = `x: ${Math.round(model.cursor.x)} y: ${Math.round(model.cursor.y)} v: ${model.verticalSemis.toFixed(1)}st`;
    debugNotes.textContent = Core.formatNotes(model.notes, 7);
    const modes = [];
    if (state.left.active) modes.push(`left bend ${model.bend.total.toFixed(1)}st`);
    if (state.right.active) modes.push("right hum");
    if (performance.now() < state.scroll.bowUntil) modes.push("bowing");
    if (model.effects.length) modes.push(model.effects.map((entry) => `${entry.key}:${entry.effect}`).join(" "));
    debugState.textContent = `${model.mode} | strings ${model.edges.length} | ${modes.join(" | ") || "idle"}`;
    debugLog.innerHTML = "";
    state.log.forEach((entry) => {
      const li = document.createElement("li");
      li.textContent = `${entry.time} ${entry.text}`;
      debugLog.appendChild(li);
    });
  }

  function triggerWave(model, strength, direction) {
    const edge = model.activeEdge ? model.activeEdge.edge : null;
    state.waves.push({
      start: performance.now(),
      edgeId: edge ? edge.id : "field",
      relation: model.relation,
      x: model.cursor.x,
      y: model.cursor.y,
      strength,
      direction
    });
    state.waves = state.waves.slice(-24);
  }

  function triggerPluck(direction, energy = 1) {
    const model = currentModel();
    state.lastPluckModel = model;
    triggerWave(model, energy, direction);
    audio.pluck(model.notes, energy, model.effects);
    state.scroll.lastDirection = direction;
    state.scroll.count += 1;
    state.scroll.bowUntil = performance.now() + 220;
    logEvent(direction < 0 ? "scroll-up" : "scroll-down", energy > 1 ? "bow" : "pluck");
  }

  function updateAudio(model) {
    audio.setGlobalEffects(model);
    if (config.keybedTone && heldKeys().length > 0) {
      audio.setContinuous("keybed", model.notes, { level: 0.42, effects: model.effects });
    } else {
      audio.stopContinuous("keybed");
    }

    if (state.left.active) {
      const leftModel = modelForAnchor(state.left.origin, true);
      state.left.model = leftModel;
      audio.setContinuous("left", leftModel.notes, { level: 0.95, effects: leftModel.effects });
    } else {
      audio.stopContinuous("left");
    }

    if (state.right.active) {
      const rightModel = modelForAnchor(state.right.origin, config.rightHumFollowsBend);
      state.right.model = rightModel;
      audio.setContinuous("right", rightModel.notes, { level: 0.7, effects: rightModel.effects });
    } else {
      audio.stopContinuous("right");
    }

    if (performance.now() < state.scroll.bowUntil) {
      audio.setContinuous("bow", model.notes, { level: 0.6, effects: model.effects });
    } else {
      audio.stopContinuous("bow");
    }
  }

  function drawString(edge, model, time, isActive) {
    const a = state.layout.nodes[edge.a];
    const b = state.layout.nodes[edge.b];
    if (!a || !b) return;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / len;
    const ny = dx / len;
    const activeEdge = model.activeEdge && model.activeEdge.edge.id === edge.id;
    const bendAmount = activeEdge ? model.bend.dx * 0.18 + -model.bend.dy * 0.12 : 0;
    const waveAmount = activeEdge && performance.now() < state.scroll.bowUntil ? Math.sin(time / 65) * 18 : 0;
    const controlX = mx + nx * (bendAmount + waveAmount);
    const controlY = my + ny * (bendAmount + waveAmount);
    const glow = config.glowIntensity / 100;
    const alpha = isActive ? 0.86 : 0.28;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = `rgba(75, 213, 255, ${0.45 * glow})`;
    ctx.shadowBlur = isActive ? 22 * glow : 10 * glow;
    ctx.strokeStyle = `rgba(115, 226, 255, ${alpha})`;
    ctx.lineWidth = isActive ? 2.7 : 1.2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(controlX, controlY, b.x, b.y);
    ctx.stroke();

    if (config.showWaves && isActive) {
      for (let i = 1; i <= 6; i += 1) {
        const offset = i * 11 + Math.sin(time / 110 + i) * 3;
        ctx.shadowBlur = 0;
        ctx.strokeStyle = `rgba(80, 190, 240, ${0.11 / i})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x + nx * offset, a.y + ny * offset);
        ctx.quadraticCurveTo(controlX + nx * offset, controlY + ny * offset, b.x + nx * offset, b.y + ny * offset);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(a.x - nx * offset, a.y - ny * offset);
        ctx.quadraticCurveTo(controlX - nx * offset, controlY - ny * offset, b.x - nx * offset, b.y - ny * offset);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawFieldWave(wave, age) {
    const radius = 18 + age * 0.18;
    const alpha = Math.max(0, 1 - age / 680) * 0.25;
    ctx.save();
    ctx.strokeStyle = `rgba(120, 230, 255, ${alpha})`;
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.arc(wave.x, wave.y, radius + i * 18, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw(time) {
    const width = state.layout.width;
    const height = state.layout.height;
    ctx.clearRect(0, 0, width, height);
    const model = currentModel();
    state.lastModel = model;

    state.waves = state.waves.filter((wave) => performance.now() - wave.start < 760);
    for (const wave of state.waves) {
      drawFieldWave(wave, performance.now() - wave.start);
    }

    for (const edge of model.edges) {
      const activeEdgeId = model.activeEdge ? model.activeEdge.edge.id : null;
      drawString(edge, model, time, edge.id === activeEdgeId || state.left.active || state.right.active);
    }

    const held = heldKeys();
    for (const node of state.layout.ordered) {
      const element = keyElements.get(node.key);
      if (!element) continue;
      const active = held.includes(node.key);
      const weighted = model.weights.find((weight) => weight.key === node.key);
      element.classList.toggle("held", active);
      element.classList.toggle("weighted", Boolean(weighted));
      element.style.setProperty("--weight", weighted ? String(Core.clamp(weighted.weight, 0.16, 1)) : "0");
      element.style.display = config.showInactive || active ? "grid" : "none";
    }

    cursorProbe.style.left = `${model.cursor.x}px`;
    cursorProbe.style.top = `${model.cursor.y}px`;
    cursorProbe.classList.toggle("active", state.left.active || state.right.active || performance.now() < state.scroll.bowUntil);

    renderDebug(model);
    updateAudio(model);
    requestAnimationFrame(draw);
  }

  function handleKeyDown(event) {
    const key = event.key.toUpperCase();
    if (event.metaKey) return;
    if (key === "SHIFT") state.modifiers.shift = true;
    if (key === "CONTROL") state.modifiers.control = true;
    if (key === "ALT") state.modifiers.alt = true;
    if (Core.INSTRUMENT_KEYS.includes(key)) {
      if (!state.keysDown.has(key)) {
        state.keysDown.add(key);
        logEvent("key-down", key);
      }
      if (!(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLSelectElement)) {
        event.preventDefault();
      }
    } else if (Core.MODIFIER_KEYS.has(key)) {
      logEvent("modifier");
    }
  }

  function handleKeyUp(event) {
    const key = event.key.toUpperCase();
    if (key === "SHIFT") state.modifiers.shift = false;
    if (key === "CONTROL") state.modifiers.control = false;
    if (key === "ALT") state.modifiers.alt = false;
    if (Core.INSTRUMENT_KEYS.includes(key)) {
      state.keysDown.delete(key);
      logEvent("key-up", key);
    } else if (Core.MODIFIER_KEYS.has(key)) {
      logEvent("modifier");
    }
  }

  function clearStuckKeys() {
    state.keysDown.clear();
    state.modifiers.shift = false;
    state.modifiers.control = false;
    state.modifiers.alt = false;
    logEvent("blur");
  }

  function bindEvents() {
    armAudioButton.addEventListener("click", async () => {
      await audio.ensure();
      stage.focus();
      logEvent("audio");
    });

    Object.values(controls).forEach((control) => {
      control.addEventListener("input", syncConfigFromControls);
      control.addEventListener("change", syncConfigFromControls);
    });

    document.getElementById("clearLog").addEventListener("click", () => {
      state.log = [];
      renderDebug(currentModel());
    });

    window.addEventListener("resize", layoutStage);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", clearStuckKeys);

    stage.addEventListener("contextmenu", (event) => event.preventDefault());
    stage.addEventListener("pointermove", (event) => {
      state.cursor = stagePointFromEvent(event);
    });
    stage.addEventListener("pointerdown", async (event) => {
      event.preventDefault();
      state.lastPointerDownAt = performance.now();
      stage.focus();
      await audio.ensure();
      state.cursor = stagePointFromEvent(event);
      stage.setPointerCapture(event.pointerId);
      if (event.button === 0) {
        state.left.active = true;
        state.left.origin = { ...state.cursor };
        state.left.model = modelForAnchor(state.left.origin, true);
        triggerWave(state.left.model, 0.72, 0);
        logEvent("left-down");
      }
      if (event.button === 2) {
        state.right.active = true;
        state.right.origin = { ...state.cursor };
        state.right.model = modelForAnchor(state.right.origin, config.rightHumFollowsBend);
        triggerWave(state.right.model, 0.52, 0);
        logEvent("right-down");
      }
    });
    stage.addEventListener("pointerup", (event) => {
      state.lastPointerUpAt = performance.now();
      if (event.button === 0) {
        if (!state.left.active) return;
        state.left.active = false;
        state.left.origin = null;
        logEvent("left-up");
      }
      if (event.button === 2) {
        if (!state.right.active) return;
        state.right.active = false;
        state.right.origin = null;
        logEvent("right-up");
      }
    });
    stage.addEventListener("mousedown", async (event) => {
      if (event.button !== 2 || performance.now() - state.lastPointerDownAt < 80) return;
      event.preventDefault();
      stage.focus();
      await audio.ensure();
      state.cursor = stagePointFromEvent(event);
      state.right.active = true;
      state.right.origin = { ...state.cursor };
      state.right.model = modelForAnchor(state.right.origin, config.rightHumFollowsBend);
      triggerWave(state.right.model, 0.52, 0);
      logEvent("right-down");
    });
    stage.addEventListener("mouseup", (event) => {
      if (event.button !== 2 || performance.now() - state.lastPointerUpAt < 80 || !state.right.active) return;
      event.preventDefault();
      state.right.active = false;
      state.right.origin = null;
      logEvent("right-up");
    });
    stage.addEventListener("pointercancel", () => {
      state.left.active = false;
      state.right.active = false;
      state.left.origin = null;
      state.right.origin = null;
      logEvent("pointer-cancel");
    });
    stage.addEventListener("wheel", async (event) => {
      event.preventDefault();
      await audio.ensure();
      state.cursor = stagePointFromEvent(event);
      const direction = event.deltaY < 0 ? -1 : 1;
      const energy = Math.min(1.7, 0.78 + Math.abs(event.deltaY) / 180);
      triggerPluck(direction, energy);
    }, { passive: false });
  }

  function installTestApi() {
    window.MKI_TEST = {
      pressKeys(keys) {
        state.testKeys = new Set(Core.normalizeHeldKeys(keys));
        logEvent("test-keys");
        return this.snapshot();
      },
      releaseKeys() {
        state.testKeys.clear();
        state.keysDown.clear();
        state.latchedKeys.clear();
        logEvent("test-release");
        return this.snapshot();
      },
      moveCursorNormalized(x, y) {
        state.cursor = {
          x: Core.clamp(x, 0, 1) * state.layout.width,
          y: Core.clamp(y, 0, 1) * state.layout.height
        };
        logEvent("test-cursor");
        return this.snapshot();
      },
      leftDown() {
        state.left.active = true;
        state.left.origin = { ...state.cursor };
        state.left.model = modelForAnchor(state.left.origin, true);
        logEvent("test-left-down");
        return this.snapshot();
      },
      leftDrag(x, y) {
        state.cursor = {
          x: Core.clamp(x, 0, 1) * state.layout.width,
          y: Core.clamp(y, 0, 1) * state.layout.height
        };
        logEvent("test-left-drag");
        return this.snapshot();
      },
      leftUp() {
        state.left.active = false;
        state.left.origin = null;
        logEvent("test-left-up");
        return this.snapshot();
      },
      rightDown() {
        state.right.active = true;
        state.right.origin = { ...state.cursor };
        state.right.model = modelForAnchor(state.right.origin, config.rightHumFollowsBend);
        logEvent("test-right-down");
        return this.snapshot();
      },
      rightUp() {
        state.right.active = false;
        state.right.origin = null;
        logEvent("test-right-up");
        return this.snapshot();
      },
      scroll(deltaY) {
        triggerPluck(deltaY < 0 ? -1 : 1, 1.1);
        return this.snapshot();
      },
      setConfig(nextConfig) {
        Object.assign(config, nextConfig || {});
        if (nextConfig && nextConfig.modifierMap) {
          config.modifierMap = { ...config.modifierMap, ...nextConfig.modifierMap };
        }
        updateOutputs();
        layoutStage();
        logEvent("test-config");
        return this.snapshot();
      },
      setModifiers(nextModifiers) {
        state.modifiers = { ...state.modifiers, ...nextModifiers };
        logEvent("test-modifiers");
        return this.snapshot();
      },
      snapshot() {
        const model = currentModel();
        return {
          heldKeys: heldKeys(),
          cursor: model.cursor,
          mode: model.mode,
          relation: model.relation,
          edgeCount: model.edges.length,
          activeEdge: model.activeEdge ? model.activeEdge.edge.id : null,
          weights: model.weights,
          notes: model.notes.map((note) => ({
            key: note.key,
            note: note.note,
            frequency: Number(note.frequency.toFixed(2)),
            weight: Number(note.weight.toFixed(3)),
            role: note.role
          })),
          bend: model.bend,
          effects: model.effects,
          log: state.log.map((entry) => entry.text)
        };
      }
    };
  }

  function init() {
    setAudioStatus("silent");
    bindEvents();
    syncConfigFromControls();
    layoutStage();
    installTestApi();
    logEvent("ready");
    requestAnimationFrame(draw);
  }

  init();
})();
