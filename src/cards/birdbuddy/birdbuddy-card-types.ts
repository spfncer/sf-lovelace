import { LovelaceCard, LovelaceCardConfig, LovelaceCardEditor } from 'custom-card-helpers';

declare global {
  interface HTMLElementTagNameMap {
    'sf-birdbuddy-card': LovelaceCard;
    'sf-birdbuddy-card-editor': LovelaceCardEditor;
    'hui-error-card': LovelaceCard;
  }
}

/**
 * Card configuration.
 *
 * The card is anchored on a single Bird Buddy "Feeder State" sensor. Every
 * sibling entity (battery, charging, recent visitor, recent visitor image) is
 * auto-discovered from the device registry, with optional per-entity overrides
 * for setups where the entity IDs were renamed.
 */
export interface SfBirdbuddyCardConfig extends LovelaceCardConfig {
  type: string;
  /** The Feeder State sensor, e.g. `sensor.backyard_buddy_feeder_state`. */
  entity: string;
  /** Header label override (defaults to the device registry name). */
  name?: string;
  /** Override for the `sensor.*_battery` entity. */
  battery_entity?: string;
  /** Override for the `binary_sensor.*_charging` entity. */
  charging_entity?: string;
  /** Override for the `sensor.*_recent_visitor` entity. */
  recent_visitor_entity?: string;
  /** Override for the `image.*_recent_visitor_image` entity. */
  image_entity?: string;
  /**
   * Custom size chosen in the dashboard editor's Layout tab. Managed by the
   * Lovelace sections layout — the card itself never reads it.
   */
  grid_options?: LovelaceGridOptions;
}

/**
 * Sections-layout sizing hints returned from the card's `getGridOptions()`
 * (Lovelace card API; not yet exported by custom-card-helpers v2).
 *
 * Sizes are in section-grid units: a section is 12 columns wide and one row
 * is 56px + 8px gap. `columns: 'full'` spans the whole section and
 * `rows: 'auto'` sizes the card to its content; the `min_*`/`max_*` bounds
 * constrain what the drag-resize UI (and YAML `grid_options`) may pick.
 */
export interface LovelaceGridOptions {
  columns?: number | 'full';
  rows?: number | 'auto';
  min_columns?: number;
  max_columns?: number;
  min_rows?: number;
  max_rows?: number;
}

/**
 * Minimal shape of the frontend entity registry entries we rely on for device
 * discovery. `hass.entities` / `hass.devices` are added by the Home Assistant
 * frontend on top of the websocket `HomeAssistant` object.
 */
export interface BirdbuddyRegistryEntry {
  device_id?: string;
  device_class?: string;
  translation_key?: string;
  original_name?: string;
  name?: string;
}

/** Minimal shape of a frontend device registry entry (for the device name). */
export interface BirdbuddyDeviceEntry {
  name?: string;
}
