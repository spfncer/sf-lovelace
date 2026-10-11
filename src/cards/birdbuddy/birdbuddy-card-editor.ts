import { LitElement, html, TemplateResult, css } from 'lit';
import { HomeAssistant, fireEvent, LovelaceCardEditor } from 'custom-card-helpers';
import { customElement, property, state } from 'lit/decorators.js';

import type { SfBirdbuddyCardConfig } from './birdbuddy-card-types';
import { localize } from '../../shared/localize/localize';

@customElement('sf-birdbuddy-card-editor')
export class SfBirdbuddyCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @state() private _config?: SfBirdbuddyCardConfig;

  private _schema = [
    {
      name: 'entity',
      required: true,
      selector: { entity: { domain: 'sensor' } },
    },
    {
      name: 'name',
      selector: { text: {} },
    },
    {
      type: 'expandable',
      name: 'interactions',
      title: localize('birdbuddy.interactions'),
      // Without `flatten`, ha-form nests children under `interactions` and the
      // card never sees them.
      flatten: true,
      schema: [
        {
          name: 'tap_entity',
          selector: {
            select: {
              mode: 'dropdown',
              options: [
                { value: 'recent_visitor', label: localize('birdbuddy.tap_recent_visitor') },
                { value: 'image', label: localize('birdbuddy.tap_image') },
              ],
            },
          },
        },
        { name: 'tap_action', selector: { ui_action: {} } },
        { name: 'hold_action', selector: { ui_action: {} } },
        { name: 'double_tap_action', selector: { ui_action: {} } },
      ],
    },
    {
      type: 'expandable',
      name: 'overrides',
      title: localize('birdbuddy.overrides'),
      // Same nesting caveat as `interactions` above.
      flatten: true,
      schema: [
        { name: 'battery_entity', selector: { entity: { domain: 'sensor' } } },
        { name: 'charging_entity', selector: { entity: { domain: 'binary_sensor' } } },
        { name: 'recent_visitor_entity', selector: { entity: { domain: 'sensor' } } },
        { name: 'image_entity', selector: { entity: { domain: 'image' } } },
      ],
    },
  ];

  public setConfig(config: SfBirdbuddyCardConfig): void {
    this._config = {
      ...config,
      // Seed the effective defaults so the form shows values on first open.
      tap_entity: config.tap_entity ?? 'recent_visitor',
      tap_action: config.tap_action ?? { action: 'more-info' },
      hold_action: config.hold_action ?? { action: 'none' },
      double_tap_action: config.double_tap_action ?? { action: 'none' },
    };
    this.requestUpdate();
  }

  protected render(): TemplateResult | void {
    if (!this.hass || !this._config) {
      return html`<div>Loading...</div>`;
    }

    return html`
      <ha-form
        .hass=${this.hass}
        .data=${this._config}
        .schema=${this._schema}
        .computeLabel=${this._computeLabel}
        @value-changed=${this._valueChanged}
      ></ha-form>
    `;
  }

  private _computeLabel = (schema: { name?: string; label?: string }): string =>
    schema.label ?? (schema.name ? localize(`birdbuddy.${schema.name}`) : '');

  private _valueChanged(ev: CustomEvent<{ value: SfBirdbuddyCardConfig }>): void {
    const config = ev.detail.value;
    if (!config) {
      return;
    }
    this._config = config;
    fireEvent(this, 'config-changed', { config });
  }

  static get styles() {
    return css`
      :host {
        display: block;
      }
      ha-form {
        display: block;
      }
    `;
  }
}

// Explicit element registration as fallback.
if (!customElements.get('sf-birdbuddy-card-editor')) {
  customElements.define('sf-birdbuddy-card-editor', SfBirdbuddyCardEditor);
}
