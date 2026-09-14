import { api, auth } from '/api.js';
import {
  isDateInputValid,
  parseDateInput,
  t,
} from '/i18n.js';
import { esc } from '/utils/html.js';
import { prefersInkText } from '/utils/contrast.js';

function initials(name) {
  if (!name) return '?';
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function avatarHtml(user, className = 'settings-avatar') {
  const safeName = esc(user?.display_name || '');
  const fallback = esc(initials(user?.display_name || ''));
  const background = esc(user?.avatar_color) || 'var(--color-accent)';
  const inkClass = prefersInkText(user?.avatar_color) ? ' settings-avatar--ink' : '';
  return `
    <div class="${className}${inkClass}" style="background:${background}" title="${safeName}">
      ${user?.avatar_data ? `<img src="${esc(user.avatar_data)}" alt="${safeName}" loading="lazy">` : fallback}
    </div>
  `;
}

function avatarEditorHtml(user) {
  return `
    <div class="settings-avatar-editor">
      <button type="button" class="settings-avatar-button" id="profile-avatar-preview" aria-label="${t('settings.profilePictureLabel')}">
        ${avatarHtml(user, 'settings-avatar settings-avatar--lg')}
      </button>
      <input class="sr-only" type="file" id="profile-avatar-file" accept="image/png,image/jpeg,image/webp" aria-label="${t('settings.profilePictureLabel')}" aria-describedby="profile-error" tabindex="-1">
      <div class="settings-avatar-actions">
        <button type="button" class="settings-avatar-action" id="profile-avatar-edit" aria-label="${t('settings.profilePictureLabel')}" title="${t('settings.profilePictureLabel')}">
          <i data-lucide="edit-2" aria-hidden="true"></i>
        </button>
        <button type="button" class="settings-avatar-action settings-avatar-action--danger" id="profile-avatar-remove" aria-label="${t('settings.profilePictureRemove')}" title="${t('settings.profilePictureRemove')}">
          <i data-lucide="trash-2" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  `;
}

function showError(element, message) {
  if (!element) return;
  element.textContent = message || t('common.errorGeneric');
  element.hidden = false;
}

function clearError(element) {
  if (!element) return;
  element.textContent = '';
  element.hidden = true;
}

function setAvatarPreview(container, user) {
  const preview = container.querySelector('#profile-avatar-preview');
  if (!preview) return;
  preview.replaceChildren();
  preview.insertAdjacentHTML(
    'beforeend',
    avatarHtml(user, 'settings-avatar settings-avatar--lg'),
  );
  window.lucide?.createIcons({ el: preview });
}

const SETTINGS_NOTICE_KEY = 'aashiyana:settings:notice';




function consumeAccessNotice() {
  let notice = null;
  try {
    notice = sessionStorage.getItem(SETTINGS_NOTICE_KEY);
    if (notice) sessionStorage.removeItem(SETTINGS_NOTICE_KEY);
  } catch {
    return null;
  }
  return notice === 'accessRedirected' ? t('settings.accessRedirected') : null;
}

function oidcCardHtml(state, notice) {
  if (!state?.enabled) return '';

  return `
    <div class="settings-card">
      <h3 class="settings-card__title">${t('settings.oidcLinkTitle')}</h3>
      ${notice ? `<p class="${notice.kind === 'error' ? 'form-error' : 'form-hint'}" role="${notice.kind === 'error' ? 'alert' : 'status'}">${esc(notice.text)}</p>` : ''}
      ${state.linked ? `
        <p class="form-hint">${state.provider
          ? t('settings.oidcLinkedWithProvider', { provider: state.provider })
          : t('settings.oidcLinked')}</p>
        ${state.can_unlink
          ? `<button type="button" class="btn btn--danger-outline" id="oidc-unlink">${t('settings.oidcUnlink')}</button>`
          : `<p class="form-hint">${t('settings.oidcUnlinkNeedsPassword')}</p>`}
      ` : `
        <p class="form-hint">${t('settings.oidcLinkHint')}</p>
        <button type="button" class="btn btn--secondary" id="oidc-link">${t('settings.oidcLink')}</button>
      `}
      <div id="oidc-error" class="form-error" role="alert" hidden></div>
    </div>
  `;
}

function consumeOidcNotice() {
  const params = new URLSearchParams(location.search);
  const ok     = params.get('oidc_linked');
  const err    = params.get('oidc_link_error');
  if (!ok && !err) return null;

  params.delete('oidc_linked');
  params.delete('oidc_link_error');
  const query = params.toString();
  history.replaceState(null, '', location.pathname + (query ? `?${query}` : ''));

  if (ok) return { kind: 'ok', text: t('settings.oidcLinkSuccess') };
  const known = ['already_linked', 'sub_taken'].includes(err);
  return {
    kind: 'error',
    text: known ? t(`settings.oidcLinkError_${err}`) : t('settings.oidcLinkErrorGeneric'),
  };
}

function twoFactorCardHtml(state) {
  if (!state) return '';

  const body = state.enabled
    ? `
      <p class="form-hint settings-2fa__status settings-2fa__status--on">
        <i data-lucide="shield-check" aria-hidden="true"></i>
        <span>${t('settings.twoFactorActive')}</span>
      </p>
      <p class="form-hint">${t('settings.twoFactorRecoveryLeft', { count: state.recovery_remaining })}</p>
      ${state.recovery_remaining === 0
        ? `<p class="form-error" role="status">${t('settings.twoFactorNoRecoveryLeft')}</p>`
        : ''}
      <div class="settings-form-actions">
        <button type="button" class="btn btn--secondary" id="two-factor-regenerate">${t('settings.twoFactorNewCodes')}</button>
        ${state.required
          ? ''
          : `<button type="button" class="btn btn--danger-outline" id="two-factor-disable">${t('settings.twoFactorDisable')}</button>`}
      </div>
      ${state.required ? `<p class="form-hint">${t('settings.twoFactorRequiredByHousehold')}</p>` : ''}
    `
    : `
      <p class="form-hint">${t('settings.twoFactorHint')}</p>
      ${state.required ? `<p class="form-error" role="status">${t('settings.twoFactorRequiredSetUpNow')}</p>` : ''}
      <div class="settings-form-actions">
        <button type="button" class="btn btn--primary" id="two-factor-start">${t('settings.twoFactorSetUp')}</button>
      </div>
    `;

  return `
    <div class="settings-card" id="two-factor-card">
      <h3 class="settings-card__title">${t('settings.twoFactorTitle')}</h3>
      ${body}
      <div id="two-factor-error" class="form-error" role="alert" hidden></div>
    </div>
  `;
}

function renderTwoFactorSetup(card, setup) {
  card.replaceChildren();


  const grouped = setup.secret.replace(/(.{4})/g, '$1 ').trim();

  card.insertAdjacentHTML('beforeend', `
    <h3 class="settings-card__title">${t('settings.twoFactorTitle')}</h3>
    <ol class="settings-2fa__steps">
      <li>${t('settings.twoFactorStepScan')}</li>
      <li>${t('settings.twoFactorStepEnter')}</li>
    </ol>
    <div class="settings-2fa__qr">
      <img src="${esc(setup.qr)}" alt="${esc(t('settings.twoFactorQrAlt'))}" width="222" height="222">
    </div>
    <p class="form-hint">${t('settings.twoFactorManualHint')}</p>
    <p class="settings-2fa__secret"><code>${esc(grouped)}</code></p>
    <form id="two-factor-enable-form" class="settings-form">
      <div class="form-group">
        <label class="form-label" for="two-factor-code">${t('settings.twoFactorCodeLabel')}</label>
        <input class="form-input settings-2fa__code" type="text" id="two-factor-code"
               inputmode="numeric" autocomplete="one-time-code" spellcheck="false"
               maxlength="8" required aria-describedby="two-factor-error">
      </div>
      <div id="two-factor-error" class="form-error" role="alert" hidden></div>
      <div class="settings-form-actions">
        <button type="submit" class="btn btn--primary">${t('settings.twoFactorConfirm')}</button>
        <button type="button" class="btn btn--secondary" id="two-factor-cancel">${t('common.cancel')}</button>
      </div>
    </form>
  `);
  window.lucide?.createIcons({ el: card });
  card.querySelector('#two-factor-code')?.focus();
}

function renderRecoveryCodes(card, codes, onDone) {
  card.replaceChildren();
  card.insertAdjacentHTML('beforeend', `
    <h3 class="settings-card__title">${t('settings.twoFactorRecoveryTitle')}</h3>
    <p class="form-hint">${t('settings.twoFactorRecoveryLead')}</p>
    <ul class="settings-2fa__codes">
      ${codes.map((code) => `<li><code>${esc(code)}</code></li>`).join('')}
    </ul>
    <div class="settings-form-actions">
      <button type="button" class="btn btn--secondary" id="two-factor-copy">${t('settings.twoFactorCopyCodes')}</button>
      <button type="button" class="btn btn--secondary" id="two-factor-download">${t('settings.twoFactorDownloadCodes')}</button>
      <button type="button" class="btn btn--primary" id="two-factor-done">${t('settings.twoFactorCodesSaved')}</button>
    </div>
    <p class="form-hint" id="two-factor-copy-status" role="status"></p>
  `);

  const status = card.querySelector('#two-factor-copy-status');

  card.querySelector('#two-factor-copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      status.textContent = t('settings.twoFactorCopied');
    } catch {


      status.textContent = t('settings.twoFactorCopyFailed');
    }
  });

  card.querySelector('#two-factor-download')?.addEventListener('click', () => {
    const blob = new Blob([`${codes.join('\n')}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'aashiyana-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  });

  card.querySelector('#two-factor-done')?.addEventListener('click', onDone);
}

function askForCode(card, texts, onConfirm, onCancel) {
  card.replaceChildren();
  card.insertAdjacentHTML('beforeend', `
    <h3 class="settings-card__title">${esc(texts.title)}</h3>
    <p class="form-hint">${esc(texts.lead)}</p>
    <form id="two-factor-confirm-form" class="settings-form">
      <div class="form-group">
        <label class="form-label" for="two-factor-confirm-code">${t('settings.twoFactorCodeOrRecoveryLabel')}</label>
        <input class="form-input settings-2fa__code" type="text" id="two-factor-confirm-code"
               inputmode="text" autocomplete="one-time-code" spellcheck="false"
               maxlength="24" required aria-describedby="two-factor-error">
      </div>
      <div id="two-factor-error" class="form-error" role="alert" hidden></div>
      <div class="settings-form-actions">
        <button type="submit" class="btn ${texts.danger ? 'btn--danger' : 'btn--primary'}">${esc(texts.confirm)}</button>
        <button type="button" class="btn btn--secondary" id="two-factor-cancel">${t('common.cancel')}</button>
      </div>
    </form>
  `);

  const form  = card.querySelector('#two-factor-confirm-form');
  const input = card.querySelector('#two-factor-confirm-code');
  const error = card.querySelector('#two-factor-error');
  input.focus();

  card.querySelector('#two-factor-cancel')?.addEventListener('click', onCancel);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError(error);
    const code = input.value.trim();
    if (!code) {
      showError(error, t('settings.twoFactorCodeMissing'));
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await onConfirm(code);
    } catch (err) {
      button.disabled = false;
      showError(error, twoFactorErrorText(err));
      input.select();
    }
  });
}

function twoFactorErrorText(err) {
  if (err?.status === 429) return t('settings.twoFactorTooManyAttempts');
  const reason = err?.data?.reason;
  if (reason === 'invalid_code') return t('settings.twoFactorInvalidCode');
  if (reason === 'required')     return t('settings.twoFactorRequiredByHousehold');
  if (reason === 'not_enabled')  return t('settings.twoFactorNotEnabled');
  return err?.message || t('settings.twoFactorGenericError');
}

function bindTwoFactorEvents(container, reload) {
  const card = container.querySelector('#two-factor-card');
  if (!card) return;
  const error = card.querySelector('#two-factor-error');

  card.querySelector('#two-factor-start')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    clearError(error);
    button.disabled = true;
    try {
      const { data } = await auth.setupTwoFactor();
      renderTwoFactorSetup(card, data);
      bindSetupForm(card, reload);
    } catch (err) {
      button.disabled = false;
      showError(error, twoFactorErrorText(err));
    }
  });

  card.querySelector('#two-factor-disable')?.addEventListener('click', () => {
    askForCode(card, {
      title:   t('settings.twoFactorDisableTitle'),
      lead:    t('settings.twoFactorDisableLead'),
      confirm: t('settings.twoFactorDisable'),
      danger:  true,
    }, async (code) => {
      await auth.disableTwoFactor(code);
      await reload();
    }, () => { reload(); });
  });

  card.querySelector('#two-factor-regenerate')?.addEventListener('click', () => {
    askForCode(card, {
      title:   t('settings.twoFactorNewCodes'),
      lead:    t('settings.twoFactorNewCodesLead'),
      confirm: t('settings.twoFactorNewCodes'),
    }, async (code) => {
      const { data } = await auth.regenerateRecoveryCodes(code);
      renderRecoveryCodes(card, data.recovery_codes, () => { reload(); });
    }, () => { reload(); });
  });
}

function bindSetupForm(card, reload) {
  const form  = card.querySelector('#two-factor-enable-form');
  const input = card.querySelector('#two-factor-code');
  const error = card.querySelector('#two-factor-error');

  card.querySelector('#two-factor-cancel')?.addEventListener('click', () => { reload(); });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError(error);
    const code = input.value.trim();
    if (!code) {
      showError(error, t('settings.twoFactorCodeMissing'));
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const { data } = await auth.enableTwoFactor(code);
      renderRecoveryCodes(card, data.recovery_codes, () => { reload(); });
    } catch (err) {
      button.disabled = false;
      showError(error, twoFactorErrorText(err));
      input.select();
    }
  });
}

function renderPage(container, user, refreshFailed, accessNotice, oidcState, oidcNotice, twoFactorState) {
  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', `
    ${accessNotice ? `
      <div class="settings-banner settings-banner--info" role="status">${esc(accessNotice)}</div>
    ` : ''}

    ${refreshFailed ? `
      <div class="settings-card">
        <p class="form-error" role="alert">${t('settings.loadError')}</p>
        <div class="settings-form-actions">
          <button type="button" class="btn btn--secondary" id="account-retry">${t('settings.retry')}</button>
        </div>
      </div>
    ` : ''}

    <section class="settings-section">
      <h2 class="settings-section__title">${t('settings.sectionAccount')}</h2>

      <div class="settings-card">
        <h3 class="settings-card__title">${t('settings.profileCardTitle')}</h3>
        <form id="profile-form" class="settings-form">
          <div class="settings-profile-editor">
            ${avatarEditorHtml(user)}
            <div class="settings-profile-editor__fields">
              <div class="settings-name-color-row">
                <div class="form-group settings-name-color-row__name">
                  <label class="form-label" for="profile-display-name">${t('settings.displayNameLabel')}</label>
                  <input class="form-input" type="text" id="profile-display-name" maxlength="128" value="${esc(user?.display_name || '')}" aria-describedby="profile-error" required>
                </div>
                <div class="form-group settings-color-field">
                  <label class="form-label" for="profile-avatar-color">${t('settings.colorLabel')}</label>
                  <input class="settings-color-button" type="color" id="profile-avatar-color" value="${esc(user?.avatar_color || '')}" aria-describedby="profile-error">
                </div>
              </div>
              <div class="form-group">
                <label class="form-label" for="profile-username">${t('settings.usernameLabel')}</label>
                <input class="form-input" type="text" id="profile-username" value="@${esc(user?.username || '')}" readonly>
                <p class="form-hint">${t('settings.usernameFixedHint')}</p>
              </div>
            </div>
          </div>
          <fieldset class="settings-fieldset">
            <legend class="settings-fieldset__legend">${t('settings.contactDetailsLegend')}</legend>
            <div class="modal-grid modal-grid--2">
              <div class="form-group">
                <label class="form-label" for="profile-phone">${t('settings.memberPhoneLabel')}</label>
                <input class="form-input" type="tel" id="profile-phone" value="${esc(user?.phone || '')}" autocomplete="tel" aria-describedby="profile-error">
              </div>
              <div class="form-group">
                <label class="form-label" for="profile-email">${t('settings.memberEmailLabel')}</label>
                <input class="form-input" type="email" id="profile-email" value="${esc(user?.email || '')}" autocomplete="email" aria-describedby="profile-error">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label" for="profile-birth-date">${t('settings.memberBirthDateLabel')}</label>
              <aashiyana-datepicker type="date" id="profile-birth-date" value="${esc(user?.birth_date || '')}" aria-describedby="profile-error"></aashiyana-datepicker>
              <p class="form-hint">${t('settings.memberContactBirthdayHint')}</p>
            </div>
          </fieldset>
          <div id="profile-error" class="form-error" role="alert" hidden></div>
          <div class="settings-form-actions">
            <button type="submit" class="btn btn--primary">${t('common.save')}</button>
          </div>
        </form>
      </div>

      <div class="settings-card">
        <h3 class="settings-card__title">${t('settings.changePassword')}</h3>
        <form id="password-form" class="settings-form">
          <div class="form-group">
            <label class="form-label" for="current-password">${t('settings.currentPasswordLabel')}</label>
            <input class="form-input" type="password" id="current-password" autocomplete="current-password" aria-describedby="password-error" required>
          </div>
          <div class="form-group">
            <label class="form-label" for="new-password">${t('settings.newPasswordLabel')}</label>
            <input class="form-input" type="password" id="new-password" autocomplete="new-password" minlength="8" aria-describedby="password-error" required>
          </div>
          <div class="form-group">
            <label class="form-label" for="confirm-password">${t('settings.confirmPasswordLabel')}</label>
            <input class="form-input" type="password" id="confirm-password" autocomplete="new-password" minlength="8" aria-describedby="password-error" required>
          </div>
          <div id="password-error" class="form-error" role="alert" hidden></div>
          <button type="submit" class="btn btn--primary">${t('settings.savePassword')}</button>
        </form>
      </div>

      ${twoFactorCardHtml(twoFactorState)}

      ${oidcCardHtml(oidcState, oidcNotice)}
    </section>

    <section class="settings-section">
      <button class="btn btn--danger-outline settings-logout-btn" id="logout-btn">${t('settings.logout')}</button>
    </section>
  `);
}

function bindOidcEvents(container) {
  const error = container.querySelector('#oidc-error');

  container.querySelector('#oidc-link')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    clearError(error);
    button.disabled = true;
    try {
      const { url } = await api.post('/auth/oidc/link/start', {});
      if (url) location.href = url;
      else throw new Error('missing url');
    } catch (err) {
      button.disabled = false;
      showError(error, err?.message || t('settings.oidcLinkErrorGeneric'));
    }
  });

  container.querySelector('#oidc-unlink')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    clearError(error);
    button.disabled = true;
    try {
      await api.delete('/auth/oidc/link');
      location.reload();
    } catch (err) {
      button.disabled = false;
      showError(error, err?.message || t('settings.oidcLinkErrorGeneric'));
    }
  });
}

function bindEvents(container, user, profileState) {
  bindOidcEvents(container);
  const profileError = container.querySelector('#profile-error');
  const avatarFile = container.querySelector('#profile-avatar-file');
  const displayName = container.querySelector('#profile-display-name');
  const avatarColor = container.querySelector('#profile-avatar-color');

  const updatePreview = () => {
    setAvatarPreview(container, {
      display_name: displayName?.value || user?.display_name,
      avatar_color: avatarColor?.value || user?.avatar_color,
      avatar_data: profileState.avatarData,
    });
  };

  container.querySelector('#profile-avatar-preview')?.addEventListener('click', () => avatarFile?.click());
  container.querySelector('#profile-avatar-edit')?.addEventListener('click', () => avatarFile?.click());
  displayName?.addEventListener('input', updatePreview);
  avatarColor?.addEventListener('input', updatePreview);

  avatarFile?.addEventListener('change', async () => {
    clearError(profileError);
    const file = avatarFile.files?.[0];




    avatarFile.value = '';
    try {
      const { pickCroppedImage } = await import('/utils/avatar-crop.js');
      const avatarData = await pickCroppedImage(file);
      if (avatarData === undefined) return; // abgebrochen: bisheriges Bild bleibt
      profileState.avatarData = avatarData;
      updatePreview();
    } catch (error) {
      showError(profileError, error.message);
    }
  });

  container.querySelector('#profile-avatar-remove')?.addEventListener('click', () => {
    profileState.avatarData = null;
    if (avatarFile) avatarFile.value = '';
    updatePreview();
  });

  const profileForm = container.querySelector('#profile-form');
  profileForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError(profileError);

    const birthDateRaw = container.querySelector('#profile-birth-date')?.value || '';
    if (!isDateInputValid(birthDateRaw)) {
      showError(profileError, t('settings.memberBirthDateInvalid'));
      return;
    }

    const submitButton = profileForm.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      const response = await auth.updateProfile({
        display_name: displayName.value.trim(),
        avatar_color: avatarColor.value,
        avatar_data: profileState.avatarData,
        phone: container.querySelector('#profile-phone')?.value.trim() || null,
        email: container.querySelector('#profile-email')?.value.trim() || null,
        birth_date: parseDateInput(birthDateRaw) || null,
      });
      if (response?.user) {
        Object.assign(user, response.user);
        profileState.avatarData = response.user.avatar_data ?? null;
        updatePreview();
      }
      window.aashiyana?.showToast(t('settings.profileSavedToast'), 'success');
    } catch (error) {
      showError(profileError, error.message);
    } finally {
      submitButton.disabled = false;
    }
  });

  const passwordForm = container.querySelector('#password-form');
  passwordForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const passwordError = container.querySelector('#password-error');
    clearError(passwordError);

    const currentPassword = container.querySelector('#current-password').value;
    const newPassword = container.querySelector('#new-password').value;
    const confirmPassword = container.querySelector('#confirm-password').value;
    if (newPassword !== confirmPassword) {
      showError(passwordError, t('settings.passwordMismatch'));
      return;
    }

    const submitButton = passwordForm.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      await api.patch('/auth/me/password', {
        current_password: currentPassword,
        new_password: newPassword,
      });
      passwordForm.reset();
      window.aashiyana?.showToast(t('settings.passwordSavedToast'), 'success');
    } catch (error) {
      showError(passwordError, error.message);
    } finally {
      submitButton.disabled = false;
    }
  });

  container.querySelector('#logout-btn')?.addEventListener('click', async () => {
    try {
      await auth.logout();
    } finally {
      window.aashiyana?.clearSession?.();
      window.aashiyana?.navigate('/login');
    }
  });
}

export async function render(container, { user }) {
  let currentUser = user || {};
  let refreshFailed = false;

  try {
    const response = await auth.me();
    if (response?.user && user) Object.assign(user, response.user);
    else if (response?.user) currentUser = response.user;
  } catch {
    refreshFailed = true;
  }

  const accessNotice = consumeAccessNotice();
  const oidcNotice   = consumeOidcNotice();


  // bleibt die Karte weg, alles andere bleibt bedienbar.
  let oidcState = null;
  try {
    oidcState = await api.get('/auth/oidc/link');
  } catch {
    oidcState = null;
  }

  // Dasselbe fuer den zweiten Faktor (#672).
  let twoFactorState = null;
  try {
    twoFactorState = (await auth.getTwoFactor())?.data ?? null;
  } catch {
    twoFactorState = null;
  }

  try {
    renderPage(container, currentUser, refreshFailed, accessNotice, oidcState, oidcNotice, twoFactorState);
    bindEvents(container, currentUser, {
      avatarData: currentUser?.avatar_data ?? null,
    });
    bindTwoFactorEvents(container, () => render(container, { user: currentUser }));
    container.querySelector('#account-retry')?.addEventListener('click', () => {
      render(container, { user: currentUser });
    });
    window.lucide?.createIcons({ el: container });
  } catch (error) {
    container.replaceChildren();
    throw error;
  }
}
