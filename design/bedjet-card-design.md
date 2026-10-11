# sf-bedjet-card — Design

**Status:** locked (pending implementation) · **Repo:** `sf-lovelace` (first card)

A compact Lovelace card for the [ha-bedjet](https://github.com/natekspencer/ha-bedjet) integration
(BedJet V2 / BedJet 3). One card = one BedJet device, anchored on its climate entity; sibling
entities are auto-discovered through the device registry (manual overrides in config).

## 1. Requirements → UI

| Requirement | UI element |
|---|---|
| Climate control as slider | target-temperature slider (device min/max) |
| Fan control as slider | fan-speed slider (5–100%, 5% steps) |
| Modes as icon-only buttons | Heat / Cool / Dry / **Off** — matching the physical remote |
| Biorhythm programs in a `<select>` | Program select under the sliders — also carries **Turbo** and **Extended Heat**, mirroring HA's native preset menu |
| Time remaining present + controllable | stepper (±15 min) + quick-set chips, paired with run-end-time readout |
| Blend into the HA UI | every control is an HA-native component (see §3a) — no bespoke styling |

## 2. Wireframe

```
┌─────────────────────────────────────────────┐
│ Master BedJet                               │  header: device name only
├─────────────────────────────────────────────┤
│        35°         │         28°           │  two-number readout
│       Setting      │        Actual         │  (target | current temperature)
│                                             │
│   [ 🔥 ][ ❄ ][ 💧 ][ ⏻ ]                  │  mode buttons — ha-control-button-group,
│                                             │  icon-only, active segment highlighted
│ Target temp   35°C                          │
│  ────────●────────────────────────         │  ha-slider (device min/max)
│ Fan          75%                            │
│  ─────●──────────────────────────           │  ha-slider (5% steps)
│ Program    [ None                     ▾ ] ⏹ │  ha-select + stop (while a program runs):
│                                             │  None · Turbo · Extended Heat · programs
│ Time remaining          ⏱ ends 6:30 AM     │
│   ( − )   1h 30m   ( + )                    │  ha-icon-button stepper (±15 min)
│   [30m] [1h] [2h] [4h] [10h]               │  ha-chip quick-set
└─────────────────────────────────────────────┘
```

## 3. UI ↔ entity mapping

| Element | Reads | Writes |
|---|---|---|
| Setting \| Actual readout | `climate.*`: `target_temperature`, `current_temperature` | — |
| Temp slider | `climate.*`: `target_temperature`, `min_temp`, `max_temp` | `climate.set_temperature` |
| Fan slider | `climate.*`: `fan_mode` (`"75%"`) | `climate.set_fan_mode` ⚠ **not** `fan.set_percentage` — the fan entity implicitly turns the device on in **Cool** when it is off |
| Mode buttons | `hvac_mode`; `hvac_modes` (Dry only present on V3) | `climate.set_hvac_mode` |
| Program select | `preset_mode`, `preset_modes` | `climate.set_preset_mode`; stop (programs) → `set_hvac_mode off` |
| Runtime row | `number.*_runtime_remaining` (+ `max`), `sensor.*_run_end_time` | `number.set_value` (minutes) |
| Program running | `sensor.*_bio_sequence_step > 0` (fallback: fan on + hvac off) | — |

### 3a. Native components

| UI element | HA component | Notes |
|---|---|---|
| Mode buttons | `ha-control-button-group` + `ha-control-button` | the same segmented control HA's climate more-info uses; active segment filled with `--primary-color` |
| Temp / fan sliders | `ha-slider` | Material slider — primary fill, no bespoke tracks or scale labels |
| Program select | `ha-select` | HA's standard dropdown incl. native popup on mobile |
| Quick-set chips | `ha-chip` | selected chip = primary fill |
| Stepper −/+ | `ha-icon-button` with MDI `minus`/`plus` | round icon buttons |
| Icons | `ha-icon` | MDI: `fire`, `snowflake`, `water`, `power`, `stop`, `clock-outline` |
| Card shell | `ha-card` + HA CSS variables | colors/sizing inherit from the active theme |

> The mockup approximates these with plain HTML/CSS (it can't load HA's components);
> the real card uses the components directly, so it blends with any theme by construction.

**Program select contents** = `preset_modes` minus memory presets:

- the integration exposes memory presets as `"M1: name" … "M3: …"`, biorhythm programs as
  their raw device names, and `Turbo` / `Extended Heat` / `None` as fixed strings — so
  *everything else* is a biorhythm program (survives renaming programs in the BedJet app);
- on V3 the options are `None · Turbo · Extended Heat · <programs>`; on V2 only
  `None · Turbo`.

**Select semantics:**

- selecting any option calls `climate.set_preset_mode` with that exact name — one code path,
  identical to HA's native preset menu;
- `None` is the integration's real preset (sends the **Heat** button) → plain heat mode;
- while **Turbo** or **Extended Heat** runs, the select reflects it via `preset_mode` (real
  state — both are mapped by the integration);
- while a **program** runs, the integration reports `preset_mode: none`, so the select holds
  the chosen program optimistically, the `running · step N` chip + ⏹ stop button appear, and
  it clears on standby.

> Note: `bio_sequence_step` is a diagnostic entity **disabled by default** — the card docs
> must tell users to enable it (fallback heuristic otherwise).

## 4. States & control availability

There is no dedicated status line — state is visible through the controls themselves
(active mode button, select value, `running · step N` chip, `ends X` in the runtime row).

| Device state | Mode buttons | Temp/Fan sliders | Select | Runtime row |
|---|---|---|---|---|
| Off | none active | disabled | shows None (starts program) | dimmed |
| Heat / Cool / Dry | active | enabled | shows None | enabled |
| Turbo | Heat lit | pinned & disabled | shows Turbo | countdown (fixed 10 min) |
| Extended Heat | Heat lit | enabled | shows Extended Heat | enabled (max 10 h) |
| Program | none active | disabled (device-driven) | program + ⏹ stop + `running · step N` | countdown only |
| Unavailable | — | all disabled | — | — |

- Turbo / Extended Heat exit: press any mode button, or pick `None` (or another preset).
- During biorhythm Wait steps the climate entity reports `off` while the fan runs — the
  program-running detection above prevents the card from misreading this as "Off".

## 5. Interaction model & BLE realities

- Every command is a BLE write; the device auto-disconnects after 60 s idle and allows only
  one BLE central at a time (BedJet app must be closed).
- **Sliders:** optimistic value while dragging, debounced send 750 ms after the last input
  event; at most one command in flight; later input coalesces into the pending value.
- **Buttons / select / chips:** fire immediately, optimistic state, reconcile on the next
  state push (BLE notifications → entity updates, usually < 1 s while connected).
- Subtle pulse on a control while its command is in flight; mismatch on reconcile animates.

## 6. Feature detection (V2 vs V3)

| Feature | Rule |
|---|---|
| Dry button | only if `dry` ∈ `hvac_modes` (V3 only) |
| Runtime row | only if `number.*_runtime_remaining` exists (V3 only) |
| Program select | always rendered; options = `preset_modes` minus `M1:–M3:` entries → V2 gets `None · Turbo`, V3 gets `None · Turbo · Extended Heat · programs` |
| Extended Heat option | only if `Extended Heat` ∈ `preset_modes` (V3 only) |
| Temp range | from climate `min_temp`/`max_temp` (V2 fixed 19–43 °C) |

The integration is **°C-only**; the card displays °C (device °F display is not exposed to HA).

## 7. Config sketch

```yaml
type: custom:sf-bedjet-card
entity: climate.master_bedjet   # everything else auto-discovered via device registry
# optional overrides:
# name, runtime_entity, end_time_entity, step_entity
```

## 8. Locked decisions (2026-10-10)

1. **Power** — fourth icon in the mode row, matching the physical remote (Off presented as a
   state alongside Heat / Cool / Dry).
2. **Turbo & Extended Heat** — live in the **Program select** together with the biorhythm
   programs, mirroring HA's native preset menu. No header pill.
3. **Memory presets (M1–M3)** — not exposed on the card.
4. **Time remaining** — ±15 min stepper + quick-set chips (30m / 1h / 2h / 4h / 10h), paired
   with the run-end-time readout.
5. **Tech stack** — [custom-cards boilerplate](https://github.com/custom-cards/boilerplate-card)
   (Lit 3 + TypeScript 5 + Rollup 4, Yarn 4 via Corepack). Repo bootstrapped as
   `sf-bedjet-card`; TODOs from the template are still in place pending implementation.
6. **Native controls** — every control uses HA's own components (`ha-control-button-group`,
   `ha-slider`, `ha-select`, `ha-chip`, `ha-icon-button`, `ha-icon`/MDI) and HA theme
   variables; nothing bespoke.
7. **No status line** — header shows the device name only; state is visible through the
   controls (active mode button, select value, runtime row).
8. **Readout** — two numbers side by side: **Setting** (target) | **Actual** (current
   temperature), separated by a divider; large numbers, small muted labels. The ambient
   temperature sensor is no longer displayed on the card.

## 9. Implementation outline

- `src/sf-bedjet-card.ts` + `src/editor.ts` + `src/types.ts` (bootstrapped, renamed, building).
- Next step: replace the boilerplate demo render with the card per this spec, wire the
  visual editor schema, and add localization keys to `en.json` + `nb.json`.
- Companion mockup: `bedjet-card-mockup.html` (fake data, previews states & interactions).
