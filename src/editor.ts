import { LitElement, html, TemplateResult, css } from 'lit';
import { HomeAssistant, fireEvent, LovelaceCardEditor } from 'custom-card-helpers';
import { customElement, property, state } from 'lit/decorators.js';

import type { SfBedjetCardConfig } from './types';
import { localize } from './localize/localize';

@customElement('sf-bedjet-card-editor')
export class SfBedjetCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @state() private _config?: SfBedjetCardConfig;

  private _schema = [
    {
      name: 'entity',
      required: true,
      selector: { entity: { domain: 'climate' } },
    },
    {
      name: 'name',
      selector: { text: {} },
    },
    {
      type: 'expandable',
      name: 'overrides',
      title: localize('bedjet.overrides'),
      schema: [
        { name: 'runtime_entity', selector: { entity: {} } },
        { name: 'end_time_entity', selector: { entity: {} } },
        { name: 'step_entity', selector: { entity: {} } },
      ],
    },
  ];

  public setConfig(config: SfBedjetCardConfig): void {
    this._config = { ...config };
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
    schema.label ?? (schema.name ? localize(`bedjet.${schema.name}`) : '');

  private _valueChanged(ev: CustomEvent<{ value: SfBedjetCardConfig }>): void {
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
if (!customElements.get('sf-bedjet-card-editor')) {
  customElements.define('sf-bedjet-card-editor', SfBedjetCardEditor);
}
