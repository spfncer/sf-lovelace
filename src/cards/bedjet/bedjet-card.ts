import { LitElement, html, nothing, TemplateResult, css, PropertyValues, CSSResultGroup } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { HassEntity } from 'home-assistant-js-websocket';
import { HomeAssistant, LovelaceCardEditor } from 'custom-card-helpers';

import type { BedjetRegistryEntry, SfBedjetCardConfig } from './bedjet-card-types';
import { localize } from '../../shared/localize/localize';

// Registering with window.customCards makes the card appear in the Lovelace
// "Add Card" picker. The array is shared by every custom card on the page.
interface WindowWithCustomCards extends Window {
  customCards: Array<{ type: string; name: string; description: string }>;
}

(window as unknown as WindowWithCustomCards).customCards =
  (window as unknown as WindowWithCustomCards).customCards || [];
(window as unknown as WindowWithCustomCards).customCards.push({
  type: 'sf-bedjet-card',
  name: 'SF BedJet Card',
  description: 'Compact BedJet V2/V3 control card',
});

type Mode = 'heat' | 'cool' | 'dry' | 'off';

/** MDI icons mirroring the physical BedJet remote. */
const MODE_ICONS: Record<Mode, string> = {
  heat: 'mdi:fire',
  cool: 'mdi:snowflake',
  dry: 'mdi:water',
  off: 'mdi:power',
};

/** Quick-set chips (minutes) for the time-remaining row. */
const QUICK_SET_MINUTES = [30, 60, 120, 240, 600];
const RUNTIME_STEP_MINUTES = 15;

/** Sliders send 750 ms after the last input event (design §5). */
const SLIDER_DEBOUNCE_MS = 750;
/** Drop an optimistic override if the device never confirms it. */
const RECONCILE_TIMEOUT_MS = 3000;

/** `ha-slider` is webawesome-based and exposes `value` as a property. */
interface SliderElement extends HTMLElement {
  value: number;
}

@customElement('sf-bedjet-card')
export class SfBedjetCard extends LitElement {
  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import('./bedjet-card-editor');
    return document.createElement('sf-bedjet-card-editor');
  }

  public static getStubConfig(hass?: HomeAssistant): Record<string, unknown> {
    const entity = hass ? (Object.keys(hass.states).find((id) => id.startsWith('climate.')) ?? '') : '';
    return { entity };
  }

  @property({ attribute: false }) public hass!: HomeAssistant;

  @state() private config!: SfBedjetCardConfig;

  // Optimistic overrides — rendered until the device confirms the command.
  @state() private _tempOverride?: number;
  @state() private _fanOverride?: number;
  @state() private _presetOverride?: string;
  @state() private _runtimeOverride?: number;

  // Command-in-flight flags drive the subtle "sending" pulse.
  @state() private _tempSending = false;
  @state() private _fanSending = false;
  @state() private _presetSending = false;
  @state() private _runtimeSending = false;

  private _tempTimer?: number;
  private _tempPending?: number;
  private _tempInFlight = false;
  private _tempLastSentAt = 0;

  private _fanTimer?: number;
  private _fanPending?: number;
  private _fanInFlight = false;
  private _fanLastSentAt = 0;

  private _presetLastSentAt = 0;
  private _runtimeLastSentAt = 0;

  private _discovery?: {
    key: string;
    hass: HomeAssistant;
    result: { runtime?: string; endTime?: string; step?: string };
  };

  public setConfig(config: SfBedjetCardConfig): void {
    if (!config) {
      throw new Error(localize('common.invalid_configuration'));
    }
    if (config.entity && !config.entity.startsWith('climate.')) {
      throw new Error('sf-bedjet-card requires a climate entity.');
    }

    this.config = { ...config };
    this._discovery = undefined;
  }

  public getCardSize(): number {
    return 10;
  }

  // Watch every entity the card renders, not just the climate entity.
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

  protected willUpdate(changedProps: PropertyValues): void {
    if (changedProps.has('hass') && this.hass && this.config) {
      this._reconcile();
    }
  }

  // ── Entity discovery ──────────────────────────────────────────────

  private get _runtimeEntity(): string | undefined {
    return this._discover().runtime;
  }

  private get _endTimeEntity(): string | undefined {
    return this._discover().endTime;
  }

  private get _stepEntity(): string | undefined {
    return this._discover().step;
  }

  private _watchedEntityIds(): string[] {
    return [this.config.entity, this._runtimeEntity, this._endTimeEntity, this._stepEntity].filter((id): id is string =>
      Boolean(id),
    );
  }

  private _climateObjectId(): string {
    return this.config.entity.split('.')[1] ?? '';
  }

  private _discover(): { runtime?: string; endTime?: string; step?: string } {
    if (this._discovery && this._discovery.key === this.config.entity && this._discovery.hass === this.hass) {
      return this._discovery.result;
    }

    const result = {
      runtime: this.config.runtime_entity,
      endTime: this.config.end_time_entity,
      step: this.config.step_entity,
    };

    const wanted: Array<[keyof typeof result, 'number' | 'sensor', string]> = [
      ['runtime', 'number', 'runtime_remaining'],
      ['endTime', 'sensor', 'run_end_time'],
      ['step', 'sensor', 'bio_sequence_step'],
    ];

    const hass = this.hass as unknown as { entities?: Record<string, BedjetRegistryEntry> };
    const entities = hass.entities;
    const deviceId = entities?.[this.config.entity]?.device_id;
    const objectId = this._climateObjectId();

    if (entities) {
      for (const [id, entry] of Object.entries(entities)) {
        if (!entry.device_id || !deviceId || entry.device_id !== deviceId) {
          continue;
        }
        const [domain, entityObjectId] = id.split('.');
        for (const [slot, wantedDomain, translationKey] of wanted) {
          if (result[slot] || domain !== wantedDomain) {
            continue;
          }
          if (
            entry.translation_key === translationKey ||
            entityObjectId === `${objectId}_${translationKey}` ||
            entityObjectId.endsWith(`_${translationKey}`)
          ) {
            result[slot] = id;
          }
        }
      }
    }

    // Fallback: match by the standard `<device>_<key>` entity id suffix. This
    // keeps the card working when the registry display entries are unavailable.
    for (const [slot, domain, translationKey] of wanted) {
      if (result[slot]) {
        continue;
      }
      const candidate = `${domain}.${objectId}_${translationKey}`;
      if (this.hass.states[candidate]) {
        result[slot] = candidate;
      }
    }

    this._discovery = { key: this.config.entity, hass: this.hass, result };
    return result;
  }

  // ── State helpers ─────────────────────────────────────────────────

  private _fanPercent(stateObj: HassEntity): number {
    const fanMode = stateObj.attributes.fan_mode as string | undefined;
    if (!fanMode) {
      return 0;
    }
    const value = parseInt(fanMode.replace('%', ''), 10);
    return Number.isNaN(value) ? 0 : value;
  }

  private _isProgramRunning(stateObj: HassEntity): boolean {
    const stepId = this._stepEntity;
    if (stepId) {
      const stepObj = this.hass.states[stepId];
      const step = stepObj ? Number(stepObj.state) : NaN;
      if (!Number.isNaN(step)) {
        return step > 0;
      }
    }
    // Fallback heuristic: during biorhythm "Wait" steps the climate entity
    // reports `off` while the fan is still running.
    return stateObj.state === 'off' && this._fanPercent(stateObj) > 0;
  }

  private _temperatureUnit(stateObj: HassEntity): string {
    return (stateObj.attributes.temperature_unit as string | undefined) ?? this.hass.config.unit_system.temperature;
  }

  private _tempStep(stateObj: HassEntity): number {
    const step = stateObj.attributes.target_temp_step as number | undefined;
    if (typeof step === 'number' && step > 0) {
      return step;
    }
    return this._temperatureUnit(stateObj).toUpperCase().includes('F') ? 1 : 0.5;
  }

  private _formatTemp(value: number | undefined, step: number): string {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return '--';
    }
    const decimals = step < 1 ? 1 : 0;
    const snapped = Math.round(value * 10 ** decimals) / 10 ** decimals;
    return Number.isInteger(snapped) ? String(snapped) : snapped.toFixed(decimals);
  }

  private _formatRuntime(minutes: number | undefined): string {
    if (typeof minutes !== 'number' || Number.isNaN(minutes) || minutes <= 0) {
      return `0${localize('bedjet.minutes_short')}`;
    }
    const total = Math.round(minutes);
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    const h = localize('bedjet.hours_short');
    const m = localize('bedjet.minutes_short');
    if (hours) {
      return mins ? `${hours}${h} ${mins}${m}` : `${hours}${h}`;
    }
    return `${mins}${m}`;
  }

  private _isMemoryPreset(name: string | undefined): boolean {
    return !!name && /^M[123]:/.test(name);
  }

  private _presetLabel(name: string): string {
    if (name === 'None') {
      return localize('bedjet.none');
    }
    if (name === 'Turbo') {
      return localize('bedjet.turbo');
    }
    if (name === 'Extended Heat') {
      return localize('bedjet.extended_heat');
    }
    return name;
  }

  private _presetOptions(stateObj: HassEntity): Array<{ value: string; label: string }> {
    const raw = (stateObj.attributes.preset_modes as string[] | undefined) ?? [];
    const programs = raw.filter((name) => name !== 'None' && !this._isMemoryPreset(name));
    const options: Array<{ value: string; label: string }> = [{ value: 'None', label: localize('bedjet.none') }];
    for (const name of programs) {
      options.push({ value: name, label: this._presetLabel(name) });
    }
    return options;
  }

  private _selectValue(stateObj: HassEntity): string {
    const override = this._presetOverride;
    if (override !== undefined) {
      return this._isMemoryPreset(override) ? 'None' : override;
    }
    const real = stateObj.attributes.preset_mode as string | null | undefined;
    if (!real || this._isMemoryPreset(real)) {
      return 'None';
    }
    return real;
  }

  private _runtimeDisplay(): number | undefined {
    if (this._runtimeOverride !== undefined) {
      return this._runtimeOverride;
    }
    const id = this._runtimeEntity;
    if (!id) {
      return undefined;
    }
    const stateObj = this.hass.states[id];
    if (!stateObj) {
      return undefined;
    }
    const value = Number(stateObj.state);
    return Number.isNaN(value) ? undefined : value;
  }

  private _runtimeMax(): number {
    const id = this._runtimeEntity;
    const max = id ? (this.hass.states[id]?.attributes.max as number | undefined) : undefined;
    return typeof max === 'number' && max > 0 ? max : QUICK_SET_MINUTES[QUICK_SET_MINUTES.length - 1];
  }

  private _isRuntimeEditable(stateObj: HassEntity): boolean {
    if (this._isProgramRunning(stateObj)) {
      return false;
    }
    const preset = stateObj.attributes.preset_mode as string | null | undefined;
    if (preset === 'Turbo') {
      return false;
    }
    return stateObj.state === 'heat' || stateObj.state === 'cool' || stateObj.state === 'dry';
  }

  private _isTurbo(stateObj: HassEntity): boolean {
    return stateObj.attributes.preset_mode === 'Turbo' || this._presetOverride === 'Turbo';
  }

  private _endsText(stateObj: HassEntity): string {
    const id = this._endTimeEntity;
    let end: Date | undefined;
    if (id) {
      const stateObjEnd = this.hass.states[id];
      if (stateObjEnd && stateObjEnd.state && !['unknown', 'unavailable'].includes(stateObjEnd.state)) {
        const parsed = new Date(stateObjEnd.state);
        if (!Number.isNaN(parsed.getTime())) {
          end = parsed;
        }
      }
    }
    if (!end) {
      const remaining = this._runtimeDisplay();
      if (this._isRuntimeEditable(stateObj) && remaining && remaining > 0) {
        end = new Date(Date.now() + remaining * 60_000);
      }
    }
    if (!end) {
      return '';
    }
    const time = end.toLocaleTimeString(this.hass.language, {
      hour: 'numeric',
      minute: '2-digit',
    });
    return `${localize('bedjet.ends')} ${time}`;
  }

  private _clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  // ── Services ──────────────────────────────────────────────────────

  private _callClimate(service: string, data: Record<string, unknown>): Promise<void> {
    return this.hass.callService('climate', service, {
      entity_id: this.config.entity,
      ...data,
    });
  }

  private _setMode(mode: Mode): void {
    this._presetOverride = undefined;
    this._callClimate('set_hvac_mode', { hvac_mode: mode });
  }

  private _onPresetSelected(ev: CustomEvent<{ value?: string | number }>): void {
    const value = ev.detail?.value;
    if (value === undefined || value === null) {
      return;
    }
    const preset = String(value);
    this._presetOverride = preset;
    this._presetSending = true;
    this._presetLastSentAt = Date.now();
    this._callClimate('set_preset_mode', { preset_mode: preset }).finally(() => {
      this._presetSending = false;
    });
  }

  private _stopProgram(): void {
    this._presetOverride = undefined;
    this._callClimate('set_hvac_mode', { hvac_mode: 'off' });
  }

  private _scheduleTemp(value: number): void {
    this._tempPending = value;
    if (this._tempTimer !== undefined) {
      window.clearTimeout(this._tempTimer);
    }
    this._tempTimer = window.setTimeout(() => {
      this._tempTimer = undefined;
      this._sendTemp();
    }, SLIDER_DEBOUNCE_MS);
  }

  private _onTempInput(ev: Event): void {
    const value = (ev.target as SliderElement).value;
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return;
    }
    this._tempOverride = value;
    this._scheduleTemp(value);
  }

  private _onTempChange(ev: Event): void {
    const value = (ev.target as SliderElement).value;
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return;
    }
    this._tempOverride = value;
    this._tempPending = value;
    if (this._tempTimer !== undefined) {
      window.clearTimeout(this._tempTimer);
      this._tempTimer = undefined;
    }
    this._sendTemp();
  }

  private _sendTemp = (): void => {
    if (this._tempPending === undefined) {
      return;
    }
    if (this._tempInFlight) {
      // Coalesce: keep the newest value and retry once the in-flight call ends.
      this._scheduleTemp(this._tempPending);
      return;
    }
    const value = this._tempPending;
    this._tempPending = undefined;
    this._tempInFlight = true;
    this._tempSending = true;
    this._tempLastSentAt = Date.now();
    this._callClimate('set_temperature', { temperature: value })
      .catch(() => undefined)
      .finally(() => {
        this._tempInFlight = false;
        this._tempSending = false;
        if (this._tempPending !== undefined) {
          this._scheduleTemp(this._tempPending);
        }
      });
  };

  private _scheduleFan(value: number): void {
    this._fanPending = value;
    if (this._fanTimer !== undefined) {
      window.clearTimeout(this._fanTimer);
    }
    this._fanTimer = window.setTimeout(() => {
      this._fanTimer = undefined;
      this._sendFan();
    }, SLIDER_DEBOUNCE_MS);
  }

  private _onFanInput(ev: Event): void {
    const value = (ev.target as SliderElement).value;
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return;
    }
    this._fanOverride = value;
    this._scheduleFan(value);
  }

  private _onFanChange(ev: Event): void {
    const value = (ev.target as SliderElement).value;
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return;
    }
    this._fanOverride = value;
    this._fanPending = value;
    if (this._fanTimer !== undefined) {
      window.clearTimeout(this._fanTimer);
      this._fanTimer = undefined;
    }
    this._sendFan();
  }

  private _sendFan = (): void => {
    if (this._fanPending === undefined) {
      return;
    }
    if (this._fanInFlight) {
      this._scheduleFan(this._fanPending);
      return;
    }
    const value = this._fanPending;
    this._fanPending = undefined;
    this._fanInFlight = true;
    this._fanSending = true;
    this._fanLastSentAt = Date.now();
    // The fan is a climate fan_mode ("75%") — using fan.set_percentage would
    // implicitly power the device on in Cool mode (design §3).
    this._callClimate('set_fan_mode', { fan_mode: `${value}%` })
      .catch(() => undefined)
      .finally(() => {
        this._fanInFlight = false;
        this._fanSending = false;
        if (this._fanPending !== undefined) {
          this._scheduleFan(this._fanPending);
        }
      });
  };

  private _setRuntime(minutes: number): void {
    const id = this._runtimeEntity;
    if (!id) {
      return;
    }
    const value = this._clamp(Math.round(minutes), 0, this._runtimeMax());
    this._runtimeOverride = value;
    this._runtimeSending = true;
    this._runtimeLastSentAt = Date.now();
    this.hass
      .callService('number', 'set_value', { entity_id: id, value })
      .catch(() => undefined)
      .finally(() => {
        this._runtimeSending = false;
      });
  }

  private _adjustRuntime(delta: number): void {
    const current = this._runtimeDisplay() ?? 0;
    this._setRuntime(current + delta);
  }

  private _reconcile(): void {
    const stateObj = this.hass.states[this.config.entity];
    if (!stateObj) {
      return;
    }
    const now = Date.now();
    const idempotent = now - RECONCILE_TIMEOUT_MS;

    if (this._tempOverride !== undefined) {
      const real = stateObj.attributes.target_temperature;
      if (typeof real === 'number' && Math.abs(real - this._tempOverride) < 0.05) {
        this._tempOverride = undefined;
      } else if (
        !this._tempInFlight &&
        this._tempPending === undefined &&
        this._tempLastSentAt > 0 &&
        this._tempLastSentAt < idempotent
      ) {
        this._tempOverride = undefined;
      }
    }

    if (this._fanOverride !== undefined) {
      const real = this._fanPercent(stateObj);
      if (Math.abs(real - this._fanOverride) < 1) {
        this._fanOverride = undefined;
      } else if (
        !this._fanInFlight &&
        this._fanPending === undefined &&
        this._fanLastSentAt > 0 &&
        this._fanLastSentAt < idempotent
      ) {
        this._fanOverride = undefined;
      }
    }

    if (this._presetOverride !== undefined && !this._isProgramRunning(stateObj)) {
      const real = stateObj.attributes.preset_mode as string | null | undefined;
      const matched = this._presetOverride === 'None' ? real == null || real === 'None' : real === this._presetOverride;
      if (matched || (this._presetLastSentAt > 0 && this._presetLastSentAt < idempotent)) {
        this._presetOverride = undefined;
      }
    }

    if (this._runtimeOverride !== undefined && this._runtimeEntity) {
      const runtimeObj = this.hass.states[this._runtimeEntity];
      const real = runtimeObj ? Number(runtimeObj.state) : NaN;
      if (!Number.isNaN(real) && Math.abs(real - this._runtimeOverride) <= 1) {
        this._runtimeOverride = undefined;
      } else if (this._runtimeLastSentAt > 0 && this._runtimeLastSentAt < idempotent) {
        this._runtimeOverride = undefined;
      }
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────

  protected render(): TemplateResult | typeof nothing {
    if (!this.hass) {
      return nothing;
    }
    if (!this.config.entity) {
      return this._showError(localize('bedjet.no_entity'));
    }
    const stateObj = this.hass.states[this.config.entity];
    if (!stateObj) {
      return this._showError(`Entity not found: ${this.config.entity}`);
    }

    return html`
      <ha-card>
        <div class="header">
          <span class="devname">${this._deviceName(stateObj)}</span>
        </div>
        ${this._renderReadout(stateObj)} ${this._renderModes(stateObj)} ${this._renderTempRow(stateObj)}
        ${this._renderFanRow(stateObj)} ${this._renderProgramRow(stateObj)} ${this._renderRuntimeRow(stateObj)}
      </ha-card>
    `;
  }

  private _deviceName(stateObj: HassEntity): string {
    return this.config.name ?? (stateObj.attributes.friendly_name as string | undefined) ?? stateObj.entity_id;
  }

  private _renderReadout(stateObj: HassEntity): TemplateResult {
    const unit = this._temperatureUnit(stateObj);
    const step = this._tempStep(stateObj);
    const target = this._tempOverride ?? (stateObj.attributes.target_temperature as number | undefined);
    const current = stateObj.attributes.current_temperature as number | undefined;

    return html`
      <div class="readout ${stateObj.state === 'off' ? 'is-off' : ''}">
        <div class="ro-col">
          <div class="ro-value">
            <span class="ro-num">${this._formatTemp(target, step)}</span>
            <span class="ro-unit">${unit}</span>
          </div>
          <div class="ro-label">${localize('bedjet.setting')}</div>
        </div>
        <div class="ro-divider"></div>
        <div class="ro-col">
          <div class="ro-value">
            <span class="ro-num">${this._formatTemp(current, step)}</span>
            <span class="ro-unit">${unit}</span>
          </div>
          <div class="ro-label">${localize('bedjet.actual')}</div>
        </div>
      </div>
    `;
  }

  private _renderModes(stateObj: HassEntity): TemplateResult {
    const hvacModes = (stateObj.attributes.hvac_modes as string[] | undefined) ?? [];
    const modes: Mode[] = ['heat', 'cool'];
    if (hvacModes.includes('dry')) {
      modes.push('dry');
    }
    modes.push('off');

    const unavailable = stateObj.state === 'unavailable';
    const running = this._isProgramRunning(stateObj);
    const activeMode: Mode | undefined = running
      ? undefined
      : stateObj.state === 'heat'
        ? 'heat'
        : stateObj.state === 'cool'
          ? 'cool'
          : stateObj.state === 'dry'
            ? 'dry'
            : stateObj.state === 'off'
              ? 'off'
              : undefined;

    return html`
      <ha-control-select
        class="modes"
        hide-option-label
        .disabled=${unavailable}
        .value=${activeMode}
        .options=${modes.map((mode) => ({
          value: mode,
          label: localize(`bedjet.mode_${mode}`),
          ariaLabel: localize(`bedjet.mode_${mode}`),
          icon: html`<ha-icon icon=${MODE_ICONS[mode]}></ha-icon>`,
        }))}
        @value-changed=${this._onModeChanged}
      ></ha-control-select>
    `;
  }

  private _onModeChanged(ev: CustomEvent<{ value?: string }>): void {
    const mode = ev.detail?.value;
    if (mode === 'heat' || mode === 'cool' || mode === 'dry' || mode === 'off') {
      this._setMode(mode);
    }
  }

  private _renderTempRow(stateObj: HassEntity): TemplateResult {
    const unit = this._temperatureUnit(stateObj);
    const step = this._tempStep(stateObj);
    const min = (stateObj.attributes.min_temp as number | undefined) ?? 19;
    const max = (stateObj.attributes.max_temp as number | undefined) ?? 43;
    const value = this._tempOverride ?? (stateObj.attributes.target_temperature as number | undefined);
    const disabled = this._slidersDisabled(stateObj);

    return html`
      <div class="row">
        <div class="rowhead">
          <span class="label">${localize('bedjet.target_temp')}</span>
          <span class="val">${this._formatTemp(value, step)}${unit}</span>
        </div>
        <ha-slider
          class=${this._tempSending ? 'sending' : ''}
          .min=${min}
          .max=${max}
          .step=${step}
          .value=${value ?? min}
          .disabled=${disabled}
          @input=${this._onTempInput}
          @change=${this._onTempChange}
        ></ha-slider>
      </div>
    `;
  }

  private _renderFanRow(stateObj: HassEntity): TemplateResult {
    const value = this._fanOverride ?? this._fanPercent(stateObj);
    const disabled = this._slidersDisabled(stateObj);

    return html`
      <div class="row">
        <div class="rowhead">
          <span class="label">${localize('bedjet.fan')}</span>
          <span class="val">${value}%</span>
        </div>
        <ha-slider
          class=${this._fanSending ? 'sending' : ''}
          .min=${5}
          .max=${100}
          .step=${5}
          .value=${value}
          .disabled=${disabled}
          @input=${this._onFanInput}
          @change=${this._onFanChange}
        ></ha-slider>
      </div>
    `;
  }

  private _renderProgramRow(stateObj: HassEntity): TemplateResult {
    const running = this._isProgramRunning(stateObj);
    const stepId = this._stepEntity;
    const stepValue = stepId ? this.hass.states[stepId]?.state : undefined;
    const stepLabel =
      running && stepValue && !Number.isNaN(Number(stepValue))
        ? `${localize('bedjet.running')} · ${localize('bedjet.step')} ${stepValue}`
        : running
          ? localize('bedjet.running')
          : '';

    return html`
      <div class="row">
        <div class="rowhead">
          <span class="label">${localize('bedjet.program')}</span>
          <span class="progstep">${stepLabel}</span>
        </div>
        <div class="progline">
          <ha-select
            class=${this._presetSending ? 'sending' : ''}
            .options=${this._presetOptions(stateObj)}
            .value=${this._selectValue(stateObj)}
            .disabled=${stateObj.state === 'unavailable'}
            @selected=${this._onPresetSelected}
          ></ha-select>
          ${running
            ? html`
                <ha-icon-button class="stopbtn" .label=${localize('bedjet.stop')} @click=${this._stopProgram}>
                  <ha-icon icon="mdi:stop"></ha-icon>
                </ha-icon-button>
              `
            : nothing}
        </div>
      </div>
    `;
  }

  private _renderRuntimeRow(stateObj: HassEntity): TemplateResult {
    if (!this._runtimeEntity) {
      return html``;
    }
    const remaining = this._runtimeDisplay();
    const editable = this._isRuntimeEditable(stateObj);
    const ends = this._endsText(stateObj);

    return html`
      <div class="row">
        <div class="rowhead">
          <span class="label">${localize('bedjet.time_remaining')}</span>
          <span class="val end">
            ${ends ? html`<ha-icon class="clock" icon="mdi:clock-outline"></ha-icon>` : nothing} ${ends}
          </span>
        </div>
        <div class="rt ${editable ? '' : 'dimmed'} ${this._runtimeSending ? 'sending' : ''}">
          <div class="stepper">
            <ha-icon-button
              .label=${localize('bedjet.decrease')}
              .disabled=${!editable || (remaining ?? 0) <= 0}
              @click=${() => this._adjustRuntime(-RUNTIME_STEP_MINUTES)}
            >
              <ha-icon icon="mdi:minus"></ha-icon>
            </ha-icon-button>
            <span class="rtval">${this._formatRuntime(remaining)}</span>
            <ha-icon-button
              .label=${localize('bedjet.increase')}
              .disabled=${!editable}
              @click=${() => this._adjustRuntime(RUNTIME_STEP_MINUTES)}
            >
              <ha-icon icon="mdi:plus"></ha-icon>
            </ha-icon-button>
          </div>
          <ha-chip-set class="chips">
            ${QUICK_SET_MINUTES.map((minutes) => {
              const selected = editable && Math.round(remaining ?? -1) === minutes;
              return html`
                <ha-assist-chip
                  class=${selected ? 'selected' : ''}
                  .label=${this._formatRuntime(minutes)}
                  .active=${selected}
                  .filled=${selected}
                  .disabled=${!editable}
                  @click=${() => this._setRuntime(minutes)}
                ></ha-assist-chip>
              `;
            })}
          </ha-chip-set>
        </div>
      </div>
    `;
  }

  private _slidersDisabled(stateObj: HassEntity): boolean {
    if (stateObj.state === 'unavailable') {
      return true;
    }
    return this._isProgramRunning(stateObj) || stateObj.state === 'off' || this._isTurbo(stateObj);
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
      }

      ha-card {
        overflow: hidden;
      }

      .header {
        padding: 16px 18px 2px;
      }
      .devname {
        font-size: 16px;
        font-weight: 600;
        color: var(--primary-text-color);
      }

      /* ── Two-number readout: Setting | Actual ─────────────────── */
      .readout {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 36px;
        padding: 10px 0 16px;
        transition: opacity 0.2s ease-in-out;
      }
      .readout.is-off {
        opacity: 0.5;
      }
      .ro-col {
        text-align: center;
        min-width: 110px;
      }
      .ro-value {
        display: flex;
        align-items: baseline;
        justify-content: center;
        gap: 3px;
      }
      .ro-num {
        font-size: 44px;
        font-weight: 300;
        line-height: 1.05;
        color: var(--primary-text-color);
        font-variant-numeric: tabular-nums;
      }
      .ro-unit {
        font-size: 22px;
        font-weight: 300;
        color: var(--secondary-text-color);
        /* Superscript placement — degree sign sits at the top of the value. */
        transform: translateY(-0.55em);
      }
      .ro-label {
        font-size: 12px;
        color: var(--secondary-text-color);
        margin-top: 2px;
      }
      .ro-divider {
        width: 1px;
        height: 40px;
        background: var(--divider-color);
      }

      /* ── Mode buttons (ha-control-select) ─────────────────────── */
      ha-control-select.modes {
        margin: 0 18px 8px;
        --mdc-icon-size: 22px;
      }

      /* ── Rows ─────────────────────────────────────────────────── */
      .row {
        border-top: 1px solid var(--divider-color);
        padding: 12px 18px 14px;
      }
      .rowhead {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 6px;
      }
      .rowhead .label {
        font-size: 12.5px;
        color: var(--secondary-text-color);
        font-weight: 500;
      }
      .rowhead .val {
        font-size: 13px;
        color: var(--primary-text-color);
        font-variant-numeric: tabular-nums;
      }
      .rowhead .val.end {
        font-size: 12px;
        color: var(--secondary-text-color);
        display: flex;
        align-items: center;
        gap: 5px;
      }
      .clock {
        --mdc-icon-size: 14px;
      }

      ha-slider {
        width: 100%;
      }

      /* ── Program select ───────────────────────────────────────── */
      .progline {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .progline ha-select {
        flex: 1;
        min-width: 0;
      }
      .progstep {
        font-size: 12px;
        color: var(--secondary-text-color);
      }
      ha-icon-button.stopbtn {
        --ha-icon-button-size: 40px;
        flex: none;
      }

      /* ── Runtime stepper + chips ──────────────────────────────── */
      .rt {
        display: flex;
        flex-direction: column;
        gap: 10px;
        transition: opacity 0.2s ease-in-out;
      }
      .rt.dimmed {
        opacity: 0.45;
        pointer-events: none;
      }
      .stepper {
        display: flex;
        align-items: center;
        gap: 12px;
        justify-content: center;
      }
      .rtval {
        min-width: 64px;
        text-align: center;
        font-size: 15px;
        color: var(--primary-text-color);
        font-variant-numeric: tabular-nums;
      }
      ha-chip-set.chips {
        justify-content: center;
      }
      ha-assist-chip.selected {
        --ha-assist-chip-active-container-color: var(--primary-color);
        --ha-chip-label-color: var(--text-primary-color);
      }

      /* ── In-flight command pulse ──────────────────────────────── */
      @keyframes command-pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.55;
        }
      }
      .sending {
        animation: command-pulse 1s ease-in-out infinite;
      }

      @media (max-width: 600px) {
        .readout {
          gap: 20px;
        }
        .ro-num {
          font-size: 38px;
        }
      }
    `;
  }
}
