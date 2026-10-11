# sf-birdbuddy-card — Design

**Status:** locked (build in progress) · **Repo:** `sf-lovelace` (second card)

A compact Lovelace card for the [ha-birdbuddy](https://github.com/jhansche/ha-birdbuddy) integration
(one card = one Bird Buddy feeder), centered on the **most recent visitor**: a full-bleed portrait
postcard photo with the recognized species, plus a small iOS-style battery/status glyph in the header.

Companion mockup: `design/birdbuddy-card-mockup.html` (fake data, previews states & interactions).

## 1. Requirements → UI

| Requirement | UI element |
|---|---|
| Show the latest visitor prominently | full-bleed **portrait 3:4** photo (from the image entity / `entity_picture`) |
| Identify the bird | species name over a bottom scrim gradient |
| Show recency | "Seen {time} ago" caption, computed from the image entity's `last_updated` |
| Handle "nothing seen yet" | empty state: "No visitors yet / Waiting for the next postcard" |
| Show device identity + status | header: device name (left, wraps up to 2 lines) |
| Battery at a glance | right-anchored **iOS-style** battery glyph (fill + terminal nub) |
| Charging as a battery state | battery glyph turns **green + bolt** while charging (no separate field) |
| Low battery | battery glyph turns **red** at ≤ 20% |
| Offline | battery glyph is **replaced** by a "disconnected" (wifi-off) symbol; hero dims |

## 2. Wireframe

```
┌──────────────────────────────┐
│ Backyard Buddy            🔋 │  header: device name (wrap ≤2 lines) + iOS battery
├──────────────────────────────┤
│ ╷                            │
│ │                            │   portrait 3:4 photo (entity_picture, cover)
│ │                            │
│ │        (bird photo)        │
│ │                            │
│ │  American Robin            │   scrim + species name
│ │  🕐 Seen 2 min ago         │
│ ╵                            │
└──────────────────────────────┘
```

Empty state (same 3:4 footprint): centered bird glyph + "No visitors yet" / "Waiting for the next
postcard".

## 3. UI ↔ entity mapping

Anchor entity = the **Feeder State** sensor (`sensor.<device>_feeder_state`, `translation_key:
feeder_state`, device class `enum`, enabled by default). Every sibling entity is auto-discovered from
the device registry (same `device_id`), with optional per-entity config overrides.

| UI element | Entity | Reads |
|---|---|---|
| Photo | `image.<device>_recent_image` (priority) | `entity_picture` attribute |
| Photo (fallback) | `sensor.<device>_recent_visitor` | `entity_picture` attribute |
| Species name | `sensor.<device>_recent_visitor` | `state` (species name string) |
| "Seen X ago" | `image.<device>_recent_image` | `last_updated` (relative to now) |
| Battery % | `sensor.<device>_battery` | `state` (int %) |
| Charging | `binary_sensor.<device>_charging` | `state === 'on'` |
| Offline | anchor (Feeder State) | `state === 'offline'` |
| Device name | anchor | device registry `device_id` → `hass.devices[name]` |

### Device name (important)

Bird Buddy uses `has_entity_name`, so each entity's `friendly_name` is only `"Feeder State"`,
`"Battery"`, etc. The **device** name (`"Backyard Buddy"`) lives on the device registry. Resolution:

```
config.name
  ?? hass.devices[device_id]?.name
  ?? anchor.attributes.friendly_name
  ?? anchor.entity_id
```

(The BedJet card reads `friendly_name` directly because its climate entity is named for the device;
Bird Buddy is different, so we look up `hass.devices`.)

## 4. Entity discovery

Extend the BedJet `_discover()` pattern (`bedjet-card.ts:175-232`): match siblings by the anchor's
`device_id`, then discriminate by domain + signature; fall back to a `<device>_<name>` candidate in
`hass.states`. Exact signatures (from `custom_components/birdbuddy`):

| Slot | Domain | Signature |
|---|---|---|
| battery | `sensor` | `device_class === 'battery'` |
| charging | `binary_sensor` | `device_class === 'battery_charging'` |
| recentVisitor | `sensor` | `original_name === 'Recent Visitor'` or `objectId` ends `_recent_visitor` |
| image | `image` | `domain === 'image'` (single image entity per feeder) |

The registry entry type (`BirdbuddyRegistryEntry`) must add `device_class?`, `original_name?`, and
`name?` fields (compare `bedjet-card-types.ts:61-64`), and `hass.devices` must be typed.

## 5. Visual behavior

- **Battery glyph** (iOS style — pill outline + terminal nub + fill):
  - normal: light fill (`rgba(255,255,255,.85)` in dark; use `--primary-text-color`-adjacent),
  - charging (`charging.state === 'on'`): green fill (`#30d158`) + black bolt,
  - low (≤ 20 % and not charging): red fill (`#ff453a`).
  - Hover `title` shows `"Charging · 82 %"` / `"82 %"`.
- **Offline**: `anchor.state === 'offline'` → hide battery, show disconnected symbol (wifi-off),
  dim the hero (`opacity .5`). Otherwise no status element at all.
- **Photo URL**: `image.entity_picture` → `recent_visitor.entity_picture` → none. Signed URLs carry an
  `Expires` query param; render as-is (the browser URL is already valid when the entity updates).
- **Empty state**: no photo URL available → render empty state (same 3:4 box to avoid layout jump).
- **Species**: only when `recent_visitor.state` is present and not `unknown`/`unavailable`; hide the
  name line otherwise. The Recent Visitor entity is **disabled by default** — docs must tell users to
  enable it for the species name (photo still works via the image entity, which is enabled by default).
- Sensible `title` tooltips; no user-facing strings hardcoded (use `localize`).

## 6. Config

```yaml
type: custom:sf-birdbuddy-card
entity: sensor.backyard_buddy_feeder_state   # anchor — the Feeder State sensor
# optional overrides:
# name: Backyard Buddy
# battery_entity: sensor.backyard_buddy_battery
# charging_entity: binary_sensor.backyard_buddy_charging
# recent_visitor_entity: sensor.backyard_buddy_recent_visitor
# image_entity: image.backyard_buddy_recent_image
```

Editor schema (`ha-form`) mirrors BedJet: a required `entity` selector filtered to `sensor`, optional
`name`, and an expandable "Entity overrides" group for the four `*_entity` fields.

## 7. Locked decisions

1. **Photo-first portrait card** — hero is a real 3:4 postcard photo (matches `Birdbuddy.jpg`,
   sample dimension 1944×2592), full-bleed, `object-fit: cover`.
2. **Header glyph is right-anchored and vertically centered against the block** (`align-items:
   center`), not text-baseline-aligned.
3. **iOS battery** — one glyph whose fill/color/bolt encode charging and low battery; charging is a
   battery *state*, never a separate field.
4. **Disconnected replaces battery** — offline swaps the battery for a wifi-off symbol; no status pill.
5. **No signal / footer** — removed (connection strength and the facts row are out of scope).
6. **State-driven updates only (v1)** — like BedJet, the card renders from `hass` state pushes; the
   `birdbuddy_new_postcard` event is intentionally **not** subscribed in v1 (noted as a future
   enhancement for instant photo updates).
7. **Names**: device name in the header wraps up to 2 lines (`-webkit-line-clamp: 2`), not ellipsis.
8. **Sizing**: implement `getGridOptions()` (Sections) with portrait-friendly defaults (columns 4,
   min 2 / max 8), content-driven height; `getCardSize()` returns 8 for Masonry.

## 8. Implementation outline

New files under `src/cards/birdbuddy/` (mirror the BedJet kebab naming + Lit patterns):

- `birdbuddy-card-types.ts` — `SfBirdbuddyCardConfig`, `BirdbuddyRegistryEntry`, global
  `HTMLElementTagNameMap` entries (`sf-birdbuddy-card`, `sf-birdbuddy-card-editor`,
  `hui-error-card`), and the local `LovelaceGridOptions` interface (copy from BedJet — it is not yet
  exported by custom-card-helpers v2).
- `birdbuddy-card.ts` — `@customElement('sf-birdbuddy-card')` → `SfBirdbuddyCard extends LitElement`:
  `getConfigElement` (dynamic import of the editor), `getStubConfig` (first `sensor.*` with
  `_feeder_state`, else first `sensor.*`), `setConfig` (throw `localize('common.invalid_configuration')`
  / require `sensor.` domain), `getCardSize`, `getGridOptions`, `@property hass`, `@state config`,
  `shouldUpdate` (compare `hass.states` of every watched entity incl. discovered siblings),
  `_discover()` (per §4), and `render` using `<ha-card>` + `<ha-icon>` (MDI: `bird`, `clock-outline`,
  `wifi`, `lightning-bolt`, `power`). Styles inline in `static styles` with HA theme vars.
- `birdbuddy-card-editor.ts` — `@customElement('sf-birdbuddy-card-editor')` + guard, schema-driven
  `<ha-form>` with HA selectors, `fireEvent(this, 'config-changed', { config })`.

Wiring & assets:

- `src/index.ts` — add `import './cards/birdbuddy/birdbuddy-card';` (side-effect).
- `src/shared/localize/languages/{en,nb,es}.json` — add a `birdbuddy` namespace (see §9).
- `README.md` — add a row to the cards table.
- `design/birdbuddy-card-mockup.html` — already exists (kept as the interactive design reference).

Do **not** bump `CARD_VERSION` / `package.json` version — the release workflow does that on tag.

Verify with `yarn build` (runs `clean` + `lint` + `rollup`).

## 9. Localization keys (`birdbuddy.*`, add to en/nb/es)

```jsonc
{
  "birdbuddy": {
    "entity": "Bird Buddy feeder",            // editor label
    "name": "Name",
    "overrides": "Entity overrides",
    "battery_entity": "Battery (sensor)",
    "charging_entity": "Charging (binary sensor)",
    "recent_visitor_entity": "Recent visitor (sensor)",
    "image_entity": "Recent visitor image",
    "offline": "Offline",                      // tooltip
    "charging": "Charging",                    // tooltip
    "battery": "Battery",                      // tooltip
    "no_visitors": "No visitors yet",
    "waiting": "Waiting for the next postcard",
    "seen_just_now": "Seen just now",
    "seen_ago": "Seen {time} ago",
    "min_short": "min",
    "hr_short": "h",
    "day_short": "d",
    "no_entity": "Please select a Bird Buddy feeder entity."
  }
}
```

Norwegian (nb): `entity` "Bird Buddy-mater", `name` "Navn", `overrides` "Enhetsoverstyringer",
`battery_entity` "Batteri (sensor)", `charging_entity` "Lading (binær sensor)",
`recent_visitor_entity` "Siste besøkende (sensor)", `image_entity` "Bilde av siste besøkende",
`offline` "Frakoblet", `charging` "Lader", `battery` "Batteri", `no_visitors` "Ingen besøkende ennå",
`waiting` "Venter på neste postkort", `seen_just_now` "Sett akkurat nå",
`seen_ago` "Sett for {time} siden", `min_short` "min", `hr_short` "t", `day_short` "d",
`no_entity` "Velg en Bird Buddy-mater."

Spanish (es): `entity` "Comedero Bird Buddy", `name` "Nombre", `overrides` "Anulaciones de entidades",
`battery_entity` "Batería (sensor)", `charging_entity` "Carga (sensor binario)",
`recent_visitor_entity` "Visitante reciente (sensor)", `image_entity` "Imagen del visitante reciente",
`offline` "Desconectado", `charging` "Cargando", `battery` "Batería",
`no_visitors` "Aún sin visitantes", `waiting` "Esperando la próxima postal",
`seen_just_now` "Visto ahora mismo", `seen_ago` "Visto hace {time}", `min_short` "min",
`hr_short` "h", `day_short` "d", `no_entity` "Selecciona un comedero Bird Buddy."