# Mouse and Keyboard Instrument

A local browser instrument prototype where held keyboard keys become note anchors, mouse position shapes pitch and string selection, and mouse buttons or scroll events play the active string.

## Run

Open `index.html` in a browser, then press **Arm Audio** once so the Web Audio graph can start.

## Controls

- Hold one or more QWERTY letter keys to define notes or strings.
- Move the cursor vertically for pitch and horizontally/along strings for note blend.
- Scroll wheel movement bows the current note/string across a finite 30-tick bow.
- Click to pluck at the current string location. Click and hold to set a bend for the next pluck or bow, then drag in any direction to bend it.
- Right-click and hold to hum from the original click point.
- Use the side panel to change instrument sound, modifier effects, bend range, pitch scale, sustain, and visual debug options.

## Test

```bash
npm test
```

The app also exposes `window.MKI_TEST` for browser-driven QA.

## License

GPL-3.0-only. See [LICENSE](./LICENSE).
