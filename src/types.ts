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
