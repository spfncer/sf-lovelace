import { LitElement, html, nothing, TemplateResult, css, PropertyValues, CSSResultGroup } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { HassEntity } from 'home-assistant-js-websocket';
import { fireEvent, HomeAssistant, LovelaceCardEditor } from 'custom-card-helpers';

import type {
  BirdbuddyDeviceEntry,
  BirdbuddyRegistryEntry,
  LovelaceGridOptions,
  SfBirdbuddyCardConfig,
} from './birdbuddy-card-types';
import { actionHandler } from '../../shared/action-handler-directive';
import { localize } from '../../shared/localize/localize';

// Registering with window.customCards makes the card appear in the Lovelace
// "Add Card" picker. The array is shared by every custom card on the page.
interface WindowWithCustomCards extends Window {
  customCards: Array<{ type: string; name: string; description: string }>;
}

(window as unknown as WindowWithCustomCards).customCards =
  (window as unknown as WindowWithCustomCards).customCards || [];
(window as unknown as WindowWithCustomCards).customCards.push({
  type: 'sf-birdbuddy-card',
  name: 'SF Bird Buddy Card',
  description: 'Latest Bird Buddy visitor postcard with feeder status',
});

/** Red battery fill threshold (design §5). */
const LOW_BATTERY_PERCENT = 20;
/** The anchor Feeder State sensor's object-id suffix. */
const FEEDER_STATE_SUFFIX = '_feeder_state';

/** Auto-discovered sibling entities on the same device. */
interface DiscoveredEntities {
  battery?: string;
  charging?: string;
  recentVisitor?: string;
  image?: string;
}

@customElement('sf-birdbuddy-card')
export class SfBirdbuddyCard extends LitElement {
  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import('./birdbuddy-card-editor');
    return document.createElement('sf-birdbuddy-card-editor');
  }

  public static getStubConfig(hass?: HomeAssistant): Record<string, unknown> {
    const ids = hass ? Object.keys(hass.states) : [];
    const entity =
      ids.find((id) => id.startsWith('sensor.') && id.endsWith(FEEDER_STATE_SUFFIX)) ??
      ids.find((id) => id.startsWith('sensor.')) ??
      '';
    return { entity };
  }

  @property({ attribute: false }) public hass!: HomeAssistant;

  @state() private config!: SfBirdbuddyCardConfig;

  private _discovery?: { key: string; hass: HomeAssistant; result: DiscoveredEntities };

  public setConfig(config: SfBirdbuddyCardConfig): void {
    if (!config) {
      throw new Error(localize('common.invalid_configuration'));
    }
    if (config.entity && !config.entity.startsWith('sensor.')) {
      throw new Error(localize('common.invalid_configuration'));
    }

    this.config = { ...config };
    this._discovery = undefined;
  }

  public getCardSize(): number {
    return 8;
  }

  /**
   * Sections-layout resize support.
   *
   * Portrait-friendly defaults: a 4-column card that can be resized between 2
   * and 8 columns with content-driven height. Returning non-empty options
   * removes the editor's "does not fully support resizing" notice.
   */
  public getGridOptions(): LovelaceGridOptions {
    return {
      columns: 4,
      rows: 'auto',
      min_columns: 2,
      max_columns: 8,
      min_rows: 4,
      max_rows: 12,
    };
  }

  // Watch every entity the card renders, not just the anchor entity.
  protected shouldUpdate(changedProps: PropertyValues): boolean {
    if (!this.config) {
      return false;
    }
    if (!changedProps.has('hass')) {
      return true;
    }
    const oldHass = changedProps.get('hass') as HomeAssistant | undefined;
    if (!oldHass || changedProps.size > 1) {
      return true;
    }
    return this._watchedEntityIds().some((id) => oldHass.states[id] !== this.hass.states[id]);
  }

  // ── Entity discovery ──────────────────────────────────────────────

  private _watchedEntityIds(): string[] {
    const discovered = this._discover();
    return [
      this.config.entity,
      discovered.battery,
      discovered.charging,
      discovered.recentVisitor,
      discovered.image,
    ].filter((id): id is string => Boolean(id));
  }

  /** The anchor's object id with the `_feeder_state` suffix removed. */
  private _baseObjectId(): string {
    const objectId = this.config.entity.split('.')[1] ?? '';
    return objectId.endsWith(FEEDER_STATE_SUFFIX) ? objectId.slice(0, -FEEDER_STATE_SUFFIX.length) : objectId;
  }

  private _discover(): DiscoveredEntities {
    if (this._discovery && this._discovery.key === this.config.entity && this._discovery.hass === this.hass) {
      return this._discovery.result;
    }

    const result: DiscoveredEntities = {
      battery: this.config.battery_entity,
      charging: this.config.charging_entity,
      recentVisitor: this.config.recent_visitor_entity,
      image: this.config.image_entity,
    };

    const hass = this.hass as unknown as { entities?: Record<string, BirdbuddyRegistryEntry> };
    const entities = hass.entities;
    const deviceId = entities?.[this.config.entity]?.device_id;

    if (entities && deviceId) {
      for (const [id, entry] of Object.entries(entities)) {
        if (entry.device_id !== deviceId) {
          continue;
        }
        const [domain, entityObjectId] = id.split('.');
        if (!result.battery && domain === 'sensor' && entry.device_class === 'battery') {
          result.battery = id;
        } else if (!result.charging && domain === 'binary_sensor' && entry.device_class === 'battery_charging') {
          result.charging = id;
        } else if (
          !result.recentVisitor &&
          domain === 'sensor' &&
          (entry.original_name === 'Recent Visitor' || entityObjectId.endsWith('_recent_visitor'))
        ) {
          result.recentVisitor = id;
        } else if (!result.image && domain === 'image') {
          result.image = id;
        }
      }
    }

    // Fallback: standard `<device>_<name>` entity ids. Keeps the card working
    // when the registry display entries are unavailable.
    const base = this._baseObjectId();
    const candidates: Array<[keyof DiscoveredEntities, string[]]> = [
      ['battery', [`sensor.${base}_battery`]],
      ['charging', [`binary_sensor.${base}_charging`]],
      ['recentVisitor', [`sensor.${base}_recent_visitor`]],
      ['image', [`image.${base}_recent_visitor_image`, `image.${base}_recent_image`]],
    ];
    for (const [slot, ids] of candidates) {
      if (result[slot]) {
        continue;
      }
      const match = ids.find((id) => this.hass.states[id]);
      if (match) {
        result[slot] = match;
      }
    }

    this._discovery = { key: this.config.entity, hass: this.hass, result };
    return result;
  }

  // ── State helpers ─────────────────────────────────────────────────

  private _deviceName(stateObj: HassEntity): string {
    const hass = this.hass as unknown as {
      entities?: Record<string, BirdbuddyRegistryEntry>;
      devices?: Record<string, BirdbuddyDeviceEntry>;
    };
    const deviceId = hass.entities?.[this.config.entity]?.device_id;
    return (
      this.config.name ??
      (deviceId ? hass.devices?.[deviceId]?.name : undefined) ??
      (stateObj.attributes.friendly_name as string | undefined) ??
      stateObj.entity_id
    );
  }

  private _batteryPercent(): number | undefined {
    const id = this._discover().battery;
    if (!id) {
      return undefined;
    }
    const stateObj = this.hass.states[id];
    if (!stateObj || stateObj.state === 'unknown' || stateObj.state === 'unavailable') {
      return undefined;
    }
    const value = Number(stateObj.state);
    return Number.isNaN(value) ? undefined : value;
  }

  private _isCharging(): boolean {
    const id = this._discover().charging;
    return id ? this.hass.states[id]?.state === 'on' : false;
  }

  private _isOffline(): boolean {
    return this.hass.states[this.config.entity]?.state === 'offline';
  }

  private _photoUrl(): string | undefined {
    const { image, recentVisitor } = this._discover();
    const fromImage = image ? (this.hass.states[image]?.attributes.entity_picture as string | undefined) : undefined;
    if (fromImage) {
      return fromImage;
    }
    const fromVisitor = recentVisitor
      ? (this.hass.states[recentVisitor]?.attributes.entity_picture as string | undefined)
      : undefined;
    return fromVisitor || undefined;
  }

  private _species(): string | undefined {
    const id = this._discover().recentVisitor;
    if (!id) {
      return undefined;
    }
    const state = this.hass.states[id]?.state;
    if (!state || state === 'unknown' || state === 'unavailable') {
      return undefined;
    }
    return state;
  }

  /**
   * Entity whose native more-info dialog should open on tap.
   *
   * Uses the configured `tap_entity`, preferring `recent_visitor`, and falls
   * back to the other discovered entity when the chosen one is missing (the
   * Recent Visitor sensor is disabled by default). Returns undefined only when
   * neither entity is available, which disables the card's tap affordance.
   */
  private _tapEntityId(): string | undefined {
    const { recentVisitor, image } = this._discover();
    const wantsImage = (this.config.tap_entity ?? 'recent_visitor') === 'image';
    const preferred = wantsImage ? image : recentVisitor;
    const fallback = wantsImage ? recentVisitor : image;
    for (const id of [preferred, fallback]) {
      if (id && this.hass.states[id]) {
        return id;
      }
    }
    return undefined;
  }

  private _handleAction = (ev: CustomEvent<{ action?: string }>): void => {
    if (ev.detail?.action !== 'tap') {
      return;
    }
    const entityId = this._tapEntityId();
    if (!entityId) {
      return;
    }
    // Canonical way for a custom card to open Home Assistant's native
    // more-info dialog: a bubbling, composed `hass-more-info` event.
    fireEvent(this, 'hass-more-info', { entityId });
  };

  /**
   * "Seen X ago" from the recent visitor sensor's `last_changed`.
   *
   * The sensor (not the image entity) carries the "when the visitor was
   * recorded" timestamp that the native HA UI shows. `last_changed` is used
   * because `last_updated` can be bumped by attribute-only refreshes, which
   * would make an old visitor look recent.
   */
  private _seenText(): string | undefined {
    const { recentVisitor } = this._discover();
    if (!recentVisitor) {
      return undefined;
    }
    const stateObj = this.hass.states[recentVisitor];
    if (!stateObj) {
      return undefined;
    }
    const timestamp = new Date(stateObj.last_changed).getTime();
    if (Number.isNaN(timestamp)) {
      return undefined;
    }

    const seconds = Math.max(0, (Date.now() - timestamp) / 1000);
    if (seconds < 60) {
      return localize('birdbuddy.seen_just_now');
    }
    const minutes = Math.floor(seconds / 60);
    let relative: string;
    if (minutes < 60) {
      relative = `${minutes} ${localize('birdbuddy.min_short')}`;
    } else {
      const hours = Math.floor(minutes / 60);
      relative =
        hours < 24
          ? `${hours} ${localize('birdbuddy.hr_short')}`
          : `${Math.floor(hours / 24)} ${localize('birdbuddy.day_short')}`;
    }
    return localize('birdbuddy.seen_ago', '{time}', relative);
  }

  // ── Rendering ─────────────────────────────────────────────────────

  protected render(): TemplateResult | typeof nothing {
    if (!this.hass) {
      return nothing;
    }
    if (!this.config.entity) {
      return this._showError(localize('birdbuddy.no_entity'));
    }
    const stateObj = this.hass.states[this.config.entity];
    if (!stateObj) {
      return this._showError(`Entity not found: ${this.config.entity}`);
    }

    const offline = this._isOffline();
    const photoUrl = this._photoUrl();
    const deviceName = this._deviceName(stateObj);

    // The card is tappable only when a more-info target is actually available.
    const tapEntityId = this._tapEntityId();
    const tapStateObj = tapEntityId ? this.hass.states[tapEntityId] : undefined;
    const tapLabel =
      (tapStateObj?.attributes.friendly_name as string | undefined) ?? localize('birdbuddy.open_details');

    return html`
      <ha-card
        class=${tapEntityId ? 'interactive' : ''}
        role=${tapEntityId ? 'button' : nothing}
        tabindex=${tapEntityId ? '0' : nothing}
        aria-label=${tapEntityId ? tapLabel : nothing}
        @action=${this._handleAction}
        ${actionHandler({ disabled: !tapEntityId })}
      >
        <div class="header">
          <span class="devname" title=${deviceName}>${deviceName}</span>
          <div class="henglyph">${this._renderStatus(offline)}</div>
        </div>
        ${photoUrl ? this._renderHero(photoUrl, offline) : this._renderEmpty(offline)}
      </ha-card>
    `;
  }

  /** Offline replaces the battery; otherwise the iOS battery (if known). */
  private _renderStatus(offline: boolean): TemplateResult | typeof nothing {
    if (offline) {
      return html`
        <span class="offline" title=${localize('birdbuddy.offline')}>
          <ha-icon icon="mdi:wifi-off"></ha-icon>
        </span>
      `;
    }

    const pct = this._batteryPercent();
    if (pct === undefined) {
      return nothing;
    }
    const charging = this._isCharging();
    const low = !charging && pct <= LOW_BATTERY_PERCENT;
    const fillClass = charging ? 'charging' : low ? 'low' : '';
    const title = charging ? `${localize('birdbuddy.charging')} · ${pct} %` : `${pct} %`;
    const fillStyle = `width: ${pct}%`;

    return html`
      <span class="batt" title=${title} aria-label=${localize('birdbuddy.battery')}>
        <span class="batt-body">
          <span class="batt-fill ${fillClass}" style=${fillStyle}></span>
          ${charging ? html`<ha-icon class="batt-bolt" icon="mdi:lightning-bolt"></ha-icon>` : nothing}
        </span>
        <span class="batt-tip"></span>
      </span>
    `;
  }

  private _renderHero(photoUrl: string, offline: boolean): TemplateResult {
    const species = this._species();
    const seen = this._seenText();
    return html`
      <div class="hero ${offline ? 'is-dimmed' : ''}">
        <img class="photo" src=${photoUrl} alt=${species ?? ''} />
        <div class="scrim"></div>
        <div class="herotext">
          ${species ? html`<div class="species">${species}</div>` : nothing}
          ${seen
            ? html`
                <div class="seen">
                  <ha-icon icon="mdi:clock-outline"></ha-icon>
                  <span>${seen}</span>
                </div>
              `
            : nothing}
        </div>
      </div>
    `;
  }

  private _renderEmpty(offline: boolean): TemplateResult {
    return html`
      <div class="empty ${offline ? 'is-dimmed' : ''}">
        <ha-icon class="empty-icon" icon="mdi:bird"></ha-icon>
        <div class="emptytitle">${localize('birdbuddy.no_visitors')}</div>
        <div class="emptysub">${localize('birdbuddy.waiting')}</div>
      </div>
    `;
  }

  private _showError(error: string): TemplateResult {
    const errorCard = document.createElement('hui-error-card');
    errorCard.setConfig({ type: 'error', error, origConfig: this.config });
    return html`${errorCard}`;
  }

  static get styles(): CSSResultGroup {
    return css`
      :host {
        display: block;
        /* Sections layout: fill the grid cell; auto-height contexts resolve
           this percentage against an auto-height parent. */
        height: 100%;
      }

      ha-card {
        overflow: hidden;
        height: 100%;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        /* Width container for the responsive rules below. */
        container-type: inline-size;
      }
      ha-card > * {
        flex-shrink: 0;
      }

      /* Tappable card — mirrors the native image card's pointer cursor.
         Native hover/press feedback is intentionally not drawn (per design). */
      ha-card.interactive {
        cursor: pointer;
      }
      ha-card.interactive:focus {
        outline: none;
      }
      ha-card.interactive:focus-visible {
        outline: 2px solid var(--primary-color);
        outline-offset: -2px;
      }

      /* ── Header: device name + right-anchored status glyph ────── */
      .header {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 18px 12px;
      }
      .devname {
        flex: 1;
        min-width: 0;
        font-size: 16px;
        font-weight: 600;
        line-height: 1.3;
        color: var(--primary-text-color);
        overflow-wrap: anywhere;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .henglyph {
        display: flex;
        align-items: center;
        flex: 0 0 auto;
        color: var(--secondary-text-color);
      }

      /* ── iOS-style battery (pill + terminal nub + fill) ───────── */
      .batt {
        display: inline-flex;
        align-items: center;
        color: var(--secondary-text-color);
      }
      .batt-body {
        position: relative;
        display: block;
        width: 24px;
        height: 12.5px;
        border: 1.5px solid currentColor;
        border-radius: 4px;
        padding: 1px;
      }
      .batt-fill {
        display: block;
        height: 100%;
        width: 0;
        background: var(--primary-text-color);
        border-radius: 2px;
        transition:
          width 0.25s ease,
          background-color 0.2s ease;
      }
      .batt-fill.charging {
        background: #30d158;
      }
      .batt-fill.low {
        background: #ff453a;
      }
      .batt-bolt {
        position: absolute;
        inset: 0;
        margin: auto;
        display: block;
        --mdc-icon-size: 11px;
        color: rgba(0, 0, 0, 0.85);
      }
      .batt-tip {
        display: block;
        width: 2px;
        height: 5px;
        margin-left: 1.5px;
        background: currentColor;
        border-radius: 0 1.5px 1.5px 0;
      }

      .offline {
        display: inline-flex;
        color: var(--secondary-text-color);
      }
      .offline ha-icon {
        --mdc-icon-size: 18px;
      }

      /* ── Hero: full-bleed portrait 3:4 photo ──────────────────── */
      .hero {
        position: relative;
        aspect-ratio: 3 / 4;
        background: var(--secondary-background-color);
        transition: opacity 0.2s ease-in-out;
      }
      .hero.is-dimmed {
        opacity: 0.5;
      }
      .photo {
        position: absolute;
        inset: 0;
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .scrim {
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg, rgba(0, 0, 0, 0) 58%, rgba(0, 0, 0, 0.72) 100%);
      }
      .herotext {
        position: absolute;
        left: 16px;
        right: 16px;
        bottom: 12px;
        color: #fff;
      }
      .species {
        font-size: 22px;
        font-weight: 600;
        line-height: 1.15;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
      }
      .seen {
        display: flex;
        align-items: center;
        gap: 5px;
        margin-top: 3px;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.85);
      }
      .seen ha-icon {
        --mdc-icon-size: 14px;
      }

      /* ── Empty state (same 3:4 footprint) ─────────────────────── */
      .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        aspect-ratio: 3 / 4;
        color: var(--secondary-text-color);
        transition: opacity 0.2s ease-in-out;
      }
      .empty.is-dimmed {
        opacity: 0.6;
      }
      .empty-icon {
        --mdc-icon-size: 56px;
        color: var(--disabled-text-color, var(--secondary-text-color));
      }
      .emptytitle {
        font-size: 15px;
        font-weight: 600;
        color: var(--primary-text-color);
      }
      .emptysub {
        font-size: 12.5px;
      }

      /* ── Narrow-width scaling ─────────────────────────────────── */
      @container (max-width: 200px) {
        .devname {
          font-size: 14px;
        }
        .species {
          font-size: 18px;
        }
      }
    `;
  }
}
