# SF BedJet Card

A custom [Lovelace](https://www.home-assistant.io/dashboards/) card for controlling
[BedJet V2 / BedJet 3](https://bedjet.com) devices through the
[ha-bedjet](https://github.com/natekspencer/ha-bedjet) integration.

> **Status:** in design — see [`design/bedjet-card-design.md`](design/bedjet-card-design.md)
> for the locked specification and [`design/bedjet-card-mockup.html`](design/bedjet-card-mockup.html)
> for an interactive mockup. The card element is currently the unmodified boilerplate
> demo implementation, renamed for this project.

## Features (planned)

- Target temperature and fan speed as sliders
- Icon-only mode buttons: Heat / Cool / Dry / Off
- Program select: Turbo, Extended Heat, and biorhythm programs
- Time remaining with stepper + quick-set chips, paired with run-end time
- Automatic V2/V3 feature detection (Dry, runtime, program availability)

## Installation

### Manual

1. Download `sf-bedjet-card.js` from the [latest release](https://github.com/REPO_OWNER/sf-lovelace/releases).
2. Copy it to `<config>/www/sf-bedjet-card.js`.
3. Add a resource entry in your dashboard settings:

```yaml
resources:
  - url: /local/sf-bedjet-card.js
    type: module
```

### HACS

Not yet published — manual installation for now.

## Configuration

### Minimal example

```yaml
type: custom:sf-bedjet-card
entity: climate.master_bedjet
```

All sibling entities (fan, runtime, sensors) are auto-discovered from the device registry.

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
5. The built card is served from the container and hot-reloads on every save
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
  - url: /local/sf-bedjet-card.js
    type: module
```

Copy or symlink `dist/sf-bedjet-card.js` into your HA `www/` folder, or use the
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
├── sf-bedjet-card.ts             # Main card element — LitElement subclass
├── editor.ts                     # Visual editor — implements LovelaceCardEditor
├── types.ts                      # TypeScript interfaces for all config fields
├── const.ts                      # CARD_VERSION constant
├── action-handler-directive.ts   # Lit directive: tap / hold / double-tap gestures
└── localize/
    ├── localize.ts               # i18n helper
    └── languages/
        ├── en.json               # English strings
        └── nb.json               # Norwegian strings
dist/
└── sf-bedjet-card.js             # Build output — serve this to HA

design/
├── bedjet-card-design.md         # Locked design specification
└── bedjet-card-mockup.html       # Interactive design mockup (fake data)
```

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

`action-handler-directive.ts` is a Lit directive that attaches gesture recognisers to any
element. Wire it up with the `actionHandler()` function and listen for the `@action` event:

```typescript
import { actionHandler } from './action-handler-directive';
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

### Adding a new language

1. Copy `src/localize/languages/en.json` to `src/localize/languages/<lang>.json`.
2. Translate the values (keep all keys identical).
3. Import and register the new translations in `src/localize/localize.ts`.

## Troubleshooting

**Card not appearing after install**
Clear your browser cache or do a hard reload (`Ctrl+Shift+R` / `Cmd+Shift+R`).

**`TypeError: Class constructor cannot be invoked without 'new'`**
Your bundler is transpiling Lit's class syntax down to ES5. Ensure `rollup.config.js` has
`terser({ ecma: 2020 })` and `typescript({ compilerOptions: { target: 'ES2022' } })`.

**Visual editor not opening**
Check the browser console for import errors from the dynamic `import('./editor')` in
`getConfigElement`. Also confirm the `sf-bedjet-card-editor` custom element tag matches
what `getConfigElement` creates.

**General Lovelace plugin troubleshooting**
See the [thomasloven wiki](https://github.com/thomasloven/hass-config/wiki/Lovelace-Plugins).

## License

MIT — see [LICENSE](LICENSE).
