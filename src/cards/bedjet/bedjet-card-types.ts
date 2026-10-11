import { LovelaceCard, LovelaceCardConfig, LovelaceCardEditor } from 'custom-card-helpers';

declare global {
  interface HTMLElementTagNameMap {
    'sf-bedjet-card': LovelaceCard;
    'sf-bedjet-card-editor': LovelaceCardEditor;
    'hui-error-card': LovelaceCard;
  }
}

/**
 * Card configuration.
 *
 * The card is anchored on a single BedJet climate entity. Every sibling entity
 * (time-remaining number, run-end-time sensor, biorhythm step sensor) is
 * auto-discovered from the device registry, with optional per-entity overrides
 * for setups where the entity IDs were renamed.
 */
export interface SfBedjetCardConfig extends LovelaceCardConfig {
  type: string;
  /** The BedJet climate entity, e.g. `climate.master_bedjet`. */
  entity: string;
  /** Header label override (defaults to the climate entity's friendly name). */
  name?: string;
  /** Override for the `number.*_runtime_remaining` entity. */
  runtime_entity?: string;
  /** Override for the `sensor.*_run_end_time` entity. */
  end_time_entity?: string;
  /** Override for the `sensor.*_bio_sequence_step` entity. */
  step_entity?: string;
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
export interface BedjetRegistryEntry {
  device_id?: string;
  translation_key?: string;
}
