# SF Lovelace Cards

A collection of personal [Lovelace](https://www.home-assistant.io/dashboards/) custom
cards for Home Assistant. Everything ships as a **single bundle** (`sf-lovelace.js`):
add one resource and every card in the collection becomes available.

## Cards

| Card | Element | Description |
| --- | --- | --- |
| [BedJet](#bedjet) | `custom:sf-bedjet-card` | Compact control card for [BedJet V2 / BedJet 3](https://bedjet.com) via the [ha-bedjet](https://github.com/natekspencer/ha-bedjet) integration |

---

## BedJet

> Design: [`design/bedjet-card-design.md`](design/bedjet-card-design.md) ·
> Mockup: [`design/bedjet-card-mockup.html`](design/bedjet-card-mockup.html)

### Features

- Target temperature and fan speed as sliders
- Icon-only mode control: Heat / Cool / Dry / Off
- Program select: Turbo, Extended Heat, and biorhythm programs
- Time remaining with stepper + quick-set chips, paired with run-end time
- Automatic V2/V3 feature detection (Dry, runtime, program availability)
- Sections-layout resizing: drag-resize from half to full section width and
  6–12 rows, auto height by default

### Configuration

```yaml
type: custom:sf-bedjet-card
entity: climate.master_bedjet
```

All sibling entities (runtime number, run-end-time sensor, biorhythm step sensor)
are auto-discovered from the device registry. Optional overrides:

```yaml
type: custom:sf-bedjet-card
entity: climate.master_bedjet
name: Master BedJet        # header label
runtime_entity: number.master_bedjet_runtime_remaining
end_time_entity: sensor.master_bedjet_run_end_time
step_entity: sensor.master_bedjet_bio_sequence_step
```

> **Program detection:** the integration's `bio_sequence_step` diagnostic sensor
> is **disabled by default**. Enable it in Settings → Devices & Services →
> Entities for exact `running · step N` tracking. Without it the card falls back
> to a heuristic (fan running while the climate entity reports `off`).

### Sizing

On Sections dashboards the card supports resizing (drag the section handles or
use the card editor's **Layout** tab). It defaults to full section width with
auto height, and can be resized from half to full width and 6–12 grid rows. The
card fills its allocated cell: extra height grows the Setting | Actual readout,
cells smaller than the content clip the bottom rows, and narrow widths scale the
readout numbers down automatically. Masonry dashboards keep using the classic
fixed card size.

---

## Installation

### HACS (recommended)

This collection is not in the HACS default store, so add it as a custom repository:

1. **HACS → ⋮ → Custom repositories**
2. **Repository:** `spfncer/sf-lovelace` · **Category:** **Dashboard** → **Add**
3. **HACS → search "SF Lovelace Cards" → Download**
4. Hard-refresh the browser. HACS registers the resource automatically; on
   YAML-mode dashboards add it yourself:

```yaml
resources:
  - url: /hacsfiles/sf-lovelace/sf-lovelace.js
    type: module
```

### Manual

1. Download `sf-lovelace.js` from the [latest release](https://github.com/spfncer/sf-lovelace/releases).
2. Copy it to `<config>/www/sf-lovelace.js`.
3. Add a resource entry in your dashboard settings:

```yaml
resources:
  - url: /local/sf-lovelace.js
    type: module
```

---

## Developer Guide

### Prerequisites

| Tool    | Minimum version | Notes                               |
| ------- | --------------- | ----------------------------------- |
| Node.js | 24              | Required by `custom-card-helpers@2` |
| Yarn    | 4               | Managed via Corepack                |

TypeScript, Rollup, ESLint, and all other build tools are installed locally via
`yarn install` — no global installs needed.

### Quick start — devcontainer (recommended)

The devcontainer gives you a full HA development environment in one click with no local
setup required.

1. Open the project in VS Code.
2. When prompted, click **Reopen in Container** (or run **Dev Containers: Rebuild Container**).
3. A local Home Assistant instance starts automatically at `http://localhost:8123`.
4. Log in with `dev` / `dev`.
5. The bundle is served from the container and hot-reloads on every save
   (`yarn start` is launched automatically).

**Requires:** [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) extension.

### Quick start — local

```bash
yarn install
yarn build
yarn start
```

Then add the built file as a Lovelace resource:

```yaml
resources:
  - url: /local/sf-lovelace.js
    type: module
```

Copy or symlink `dist/sf-lovelace.js` into your HA `www/` folder, or use the
devcontainer where this is handled automatically.

### Available scripts

| Command          | Description                                             |
| ---------------- | ------------------------------------------------------- |
| `yarn build`     | Lint + production bundle (minified, ES2022 output)      |
| `yarn rollup`    | Production bundle only (skips lint)                     |
| `yarn start`     | Development watcher with hot reload (`rollup --watch`)   |
| `yarn lint`      | ESLint across all `src/` files                          |

### Project structure

```
src/
├── index.ts                       # Bundle entry — imports every card so it registers
├── cards/
│   └── bedjet/
│       ├── bedjet-card.ts         # Main card element — LitElement subclass
│       ├── bedjet-card-editor.ts  # Visual editor — implements LovelaceCardEditor
│       └── bedjet-card-types.ts   # TypeScript interfaces for the card config
└── shared/
    ├── const.ts                   # CARD_VERSION constant
    ├── action-handler-directive.ts# Lit directive: tap / hold / double-tap gestures
    └── localize/
        ├── localize.ts            # i18n helper
        └── languages/
            ├── en.json            # English strings
            ├── es.json            # Spanish strings
            └── nb.json            # Norwegian strings
dist/
└── sf-lovelace.js                 # Build output — serve this to HA

design/
├── bedjet-card-design.md          # Locked design specification
└── bedjet-card-mockup.html        # Interactive design mockup (fake data)
```

### Adding a card to the collection

1. Create `src/cards/<card>/` with your card element and (optionally) an editor.
2. Register it with `@customElement(...)` and push a `window.customCards` entry so it
   shows up in the picker.
3. Import the card at the top of `src/index.ts` so it is included in the bundle.
4. Add a row to the Cards table above.

### Localization

New translation keys go in `src/shared/localize/languages/*.json`, namespaced per card
(e.g. `bedjet.*`). Add the same keys to **every** language file.

To add a language: copy `en.json`, translate the values (keep keys identical), then
import and register it in `src/shared/localize/localize.ts`.

### Toolchain summary

| Tool                        | Version | Role                                            |
| --------------------------- | ------- | ----------------------------------------------- |
| Lit                         | 3.2     | Web components framework                        |
| TypeScript                  | 5.6     | Type checking and compilation                   |
| Rollup                      | 4       | Bundler — single `.js` output with tree-shaking |
| `@rollup/plugin-typescript` | 11      | TypeScript integration                           |
| `@rollup/plugin-terser`     | 0.4     | Minifier                                        |
| ESLint                      | 8       | Linting with TypeScript and Prettier integration |

> **Important:** Rollup and Terser are both configured for ES2022 output
> (`ecma: 2022`, `target: 'ES2022'`). Do **not** lower these targets. Lit 3 uses native
> ES6 `class` syntax and the `extends` keyword; downgrading to ES5 causes a runtime
> `TypeError: Class constructor cannot be invoked without 'new'`.

### Action handler directive

`shared/action-handler-directive.ts` is a Lit directive that attaches gesture recognisers
to any element. Wire it up with the `actionHandler()` function and listen for the `@action`
event:

```typescript
import { actionHandler } from '../../shared/action-handler-directive';
import { handleAction, ActionHandlerEvent } from 'custom-card-helpers';

// In your render():
html`
  <div
    ${actionHandler({ hasHold: true, hasDoubleClick: true })}
    @action=${this._handleAction}
    tabindex="0"
  >...</div>
`

// Handler:
private _handleAction(ev: ActionHandlerEvent): void {
  handleAction(this, this.hass, this.config, ev.detail.action);
}
```

| Gesture       | Activated by                        |
| ------------- | ----------------------------------- |
| Tap           | Release before the hold threshold   |
| Hold          | Press held for 500 ms               |
| Hold + repeat | Fires every `repeat` ms while held  |
| Double tap    | Two taps within 250 ms              |
| Keyboard      | Enter or Space triggers tap         |

---

## Troubleshooting

**Card not appearing after install**
Clear your browser cache or do a hard reload (`Ctrl+Shift+R` / `Cmd+Shift+R`).

**`TypeError: Class constructor cannot be invoked without 'new'`**
Your bundler is transpiling Lit's class syntax down to ES5. Ensure `rollup.config.js` has
`terser({ ecma: 2020 })` and `typescript({ compilerOptions: { target: 'ES2022' } })`.

**Visual editor not opening**
Check the browser console for import errors from the dynamic `import('./bedjet-card-editor')`
in `getConfigElement`. Also confirm the `sf-bedjet-card-editor` custom element tag matches
what `getConfigElement` creates.

**General Lovelace plugin troubleshooting**
See the [thomasloven wiki](https://github.com/thomasloven/hass-config/wiki/Lovelace-Plugins).

## License

MIT — see [LICENSE](LICENSE).
