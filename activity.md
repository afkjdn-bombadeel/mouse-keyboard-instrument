# Activity

## 2026-05-16

- Created the first static prototype of Mouse and Keyboard Instrument.
- Added the QWERTY node surface, glowing string canvas, Web Audio synthesis, modifier effects, click/drag/scroll playing states, right-click hum, and debug logging.
- Added a small Node test suite for the instrument geometry and note model.

## 2026-05-17

- Updated scroll-wheel gesture handling so one wheel tick plucks, rapid same-direction scroll sustains bowing, and quick direction changes produce alternate-picking plucks.

- Added distinct scroll visuals: blue cursor/string impulse rings for single plucks and golden bow strokes for sustained same-direction wheel strumming.

- Changed golden bow strokes so their line stays parallel to the active string while sweeping perpendicularly through it; scroll direction controls top-to-bottom versus bottom-to-top motion.

- Added instrument sound presets for electric, piano, guitar, nylon guitar, strings, and organ; pluck and sustained voices now use preset-specific oscillator/filter/envelope settings.
- Reworked bow visuals into one persistent perpendicular golden stroke tied to the active string instead of many emitted bow lines.

- Reworked bowing into a finite 20-scroll bow: same-direction wheel movement advances bow position instead of looping, with end-tension and direction coloring the sustained bow sound.
- Disabled held-key preview by default and removed left-click drag as an independent sound source; left drag now only bends plucked, bowed, or right-click-resonated notes.

- Updated interaction model: scroll wheel is bow-only over a 30-scroll bow, left click plucks, pluck rings are tighter, organ/chromatic are defaults, and chord anchors keep a minimum presence at extremes.
- Added persistent orange right-click-hum origin visualization while right-click resonance is held.

- Added bow-speed and bow-position sound shaping: faster scroll adds attack/brightness, direction colors the bow, and bow end/middle positions alter tension, gain, and filter tone.
- Fixed right-click-hold origin marker to stay at the raw pointer coordinate where the hum was initiated, not snapped to the nearest string.

- Decoupled left-click plucking from right-click hum state so left plucks use the live cursor/string and do not intentionally stop or reuse the right-click-hold origin.

- Fully separated pluck model/waves from right-hold model: left pluck now computes from its own click snapshot and uses independent visual/audio channel ids so right-hold cannot suppress the blue pluck rings.

- Fixed chorded mouse handling for right-click-hold plus left-click plucks: left pluck now also starts from pointer `buttons` bitmask transitions and mouse fallback events, so a secondary-button hold does not depend on the browser emitting a clean left `pointerdown`.

- Consolidated scroll-bow articulation around a tested 30-step bow model: wheel speed now drives attack/transient rosin, up/down strokes produce different pitch scrape/brightness/overtone color, and the browser smoke test confirmed active A-K bowing with audio armed.

- Increased scroll-bow speed sensitivity after live use felt too subtle: ordinary slow/medium/fast wheel movement now spans a much wider attack, brightness, overtone, and rosin-transient range.

- Removed the separate bow transient/noise source after it made scrolling sound like its own instrument; scroll bow speed now only shapes the continuous active string/chord voice.

- Made scroll speed more audible inside the bowed string voice by increasing speed-driven pressure, brightness, gain, attack response, overtone color, and note-internal bow flutter without adding a separate sound source.

- Extended scroll-bow continuity for very slow bowing: same-direction wheel ticks up to 1.0 second apart now keep the active bow voice alive instead of stopping and re-triggering.

- Updated the visual style to a flat dark navy `#02021a` background with liquid-glass key nodes using translucent layers, rim highlights, blur, and active weighted glow.

- Darkened the flat navy background further to `#000010` while preserving the liquid-glass key contrast.

- Cleaned up the bowed-note tone after it sounded too synthetic: default organ bow now uses a sine carrier and bow pressure mostly shapes the active note with reduced pitch scrape, flutter, overtone boost, and brightness.

- Raised the cleaned-up bowed string voice level and ceiling so the bow is louder without bringing back the synthetic edge.

- Raised the clean bow voice again toward the perceived volume of right-click-hold by increasing the bow channel level and gain ceiling.

- Moved the bow timbre closer to click notes while keeping it continuous: the bow now uses the same oscillator character and a note-centered pluck-like filter, with only gentle bow pressure/end-position variation.
