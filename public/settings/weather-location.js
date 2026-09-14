import { t } from '/i18n.js';
import { esc } from '/utils/html.js';
import { toggleRowHtml } from '/settings/components.js';

export const HOUSEHOLD_WEATHER_SCOPE = 'weather';
export const PERSONAL_WEATHER_SCOPE = 'pweather';

export function isConnectedWeatherControl(control, container) {
  return Boolean(control?.isConnected && container?.isConnected);
}

export function hasValidWeatherCoords(lat, lon) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  return lat !== ''
    && lon !== ''
    && Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

export function weatherLocationFieldsHtml({ scope, values = {}, autoLocateDisabled = false }) {
  const units = values.units === 'imperial' ? 'imperial' : 'metric';
  return `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="${scope}-lat">${t('settings.weatherLatLabel')}</label>
        <input class="form-input" type="number" id="${scope}-lat" step="any" min="-90" max="90"
          value="${esc(values.lat ?? '')}" placeholder="${t('settings.weatherLatPlaceholder')}">
      </div>
      <div class="form-group">
        <label class="form-label" for="${scope}-lon">${t('settings.weatherLonLabel')}</label>
        <input class="form-input" type="number" id="${scope}-lon" step="any" min="-180" max="180"
          value="${esc(values.lon ?? '')}" placeholder="${t('settings.weatherLonPlaceholder')}">
      </div>
    </div>
    <div class="settings-form-actions">
      <button type="button" class="btn btn--secondary btn--sm" id="${scope}-locate-btn">
        <i data-lucide="map-pin" aria-hidden="true"></i>
        ${t('settings.weatherLocateBtn')}
      </button>
    </div>
    <div class="form-group">
      ${toggleRowHtml({
        label: t('settings.weatherAutoLocateLabel'),
        checked: !!values.auto_locate,
        disabled: autoLocateDisabled,
        attrs: { id: `${scope}-auto-locate` },
      })}
      <p class="form-hint">${t('settings.weatherAutoLocateHint')}</p>
    </div>
    <div class="form-group">
      <label class="form-label" for="${scope}-city">${t('settings.weatherCityLabel')}</label>
      <input class="form-input" type="text" id="${scope}-city" maxlength="100"
        value="${esc(values.city ?? '')}" placeholder="${t('settings.weatherCityPlaceholder')}">
    </div>
    <div class="form-group">
      <label class="form-label" for="${scope}-units">${t('settings.weatherUnitsLabel')}</label>
      <select class="form-input" id="${scope}-units">
        <option value="metric"${units === 'metric' ? ' selected' : ''}>${t('settings.weatherUnitsMetric')}</option>
        <option value="imperial"${units === 'imperial' ? ' selected' : ''}>${t('settings.weatherUnitsImperial')}</option>
      </select>
    </div>
  `;
}

export function readWeatherLocation(container, scope) {
  return {
    lat: container.querySelector(`#${scope}-lat`)?.value.trim() ?? '',
    lon: container.querySelector(`#${scope}-lon`)?.value.trim() ?? '',
    city: container.querySelector(`#${scope}-city`)?.value.trim() ?? '',
    units: container.querySelector(`#${scope}-units`)?.value ?? 'metric',
    auto_locate: container.querySelector(`#${scope}-auto-locate`)?.checked ?? false,
  };
}

function requestLocation(container, scope, locateButton) {
  if (!navigator.geolocation) {
    window.aashiyana?.showToast(t('settings.weatherLocateUnsupported'), 'warning');
    return;
  }

  locateButton.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (position) => {


      if (!isConnectedWeatherControl(locateButton, container)) return;

      container.querySelector(`#${scope}-lat`).value = position.coords.latitude.toFixed(4);
      container.querySelector(`#${scope}-lon`).value = position.coords.longitude.toFixed(4);
      locateButton.disabled = false;
      window.aashiyana?.showToast(t('settings.weatherLocateSuccess'), 'success');
    },
    (error) => {
      if (!isConnectedWeatherControl(locateButton, container)) return;

      locateButton.disabled = false;
      window.aashiyana?.showToast(error.message || t('common.errorGeneric'), 'danger');
    },
    { enableHighAccuracy: true, timeout: 8000 },
  );
}

export function bindWeatherLocationEvents(container, scope) {
  const locateButton = container.querySelector(`#${scope}-locate-btn`);
  locateButton?.addEventListener('click', () => requestLocation(container, scope, locateButton));

  const autoLocate = container.querySelector(`#${scope}-auto-locate`);
  autoLocate?.addEventListener('change', () => {
    if (autoLocate.checked && locateButton) requestLocation(container, scope, locateButton);
  });
}
