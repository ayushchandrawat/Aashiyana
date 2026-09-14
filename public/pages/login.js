
import { auth } from '/api.js';
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';

const VERSION_URL = '/api/v1/version';
const DEFAULT_APP_NAME = 'Aashiyana';
const APP_NAME_STORAGE_KEY = 'aashiyana-app-name';

function getStoredAppName() {
  return localStorage.getItem(APP_NAME_STORAGE_KEY) || DEFAULT_APP_NAME;
}

function setAppBranding(appName) {
  const name = String(appName || '').trim() || DEFAULT_APP_NAME;
  document.title = name;
  const titleEl = document.querySelector('.auth-hero__title');
  if (titleEl) titleEl.textContent = name;
}

export async function render(container) {
  const storedAppName = getStoredAppName();





  const oidc = await fetchOidcConfig();
  const ssoEnabled = oidc?.enabled === true;




  const passwordLoginEnabled = !(ssoEnabled && oidc?.password_login_enabled === false);





  const guestPasswordLoginEnabled = oidc?.guest_password_login_enabled === true;

  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', `
    <main class="auth-page" id="main-content">
      <div class="auth-hero">
        <span class="auth-hero__mark" aria-hidden="true">
          <svg viewBox="0 0 160 160" fill="currentColor">
            <g fill-opacity="0.82">
              <circle cx="64" cy="72" r="27" />
              <circle cx="100" cy="78" r="25" />
              <circle cx="80" cy="106" r="24" />
            </g>
          </svg>
        </span>
        <h1 class="auth-hero__title">${esc(storedAppName)}</h1>
        <p class="auth-hero__tagline">${esc(t('login.tagline'))}</p>
      </div>
      <div class="auth-card card card--padded">
        ${!passwordLoginEnabled ? `
        <div class="auth-form" id="sso-only-block">
          <p class="auth-form__sso-only">${esc(t('login.ssoOnlyHint'))}</p>
          <a href="/api/v1/auth/oidc/start" class="btn btn--primary auth-form__submit">${esc(t('login.loginWithSso'))}</a>
          ${guestPasswordLoginEnabled ? `
          <p class="auth-form__forgot">
            <button type="button" class="auth-linkish" id="show-password-form">${esc(t('login.guestPasswordLogin'))}</button>
          </p>
          ` : ''}
        </div>
        ` : ''}
        <form class="auth-form" id="auth-form" novalidate ${!passwordLoginEnabled ? 'hidden' : ''}>
          <div class="form-group">
            <label class="label" for="username">${esc(t('login.usernameLabel'))}</label>
            <input
              class="input"
              type="text"
              id="username"
              name="username"
              autocomplete="username"
              autocapitalize="none"
              autocorrect="off"
              required
            />
          </div>

          <div class="form-group">
            <label class="label" for="password">${esc(t('login.passwordLabel'))}</label>
            <input
              class="input"
              type="password"
              id="password"
              name="password"
              autocomplete="current-password"
              required
            />
            <p class="auth-capslock" id="auth-capslock" role="status" hidden>
              <i data-lucide="arrow-up" aria-hidden="true"></i>
              <span>${esc(t('login.capsLockWarning'))}</span>
            </p>
          </div>

          <div class="form-error" id="form-error" role="alert" tabindex="-1" hidden></div>

          <button type="submit" class="btn btn--primary auth-form__submit" id="auth-btn">
            <span class="auth-btn__label">${esc(t('login.loginButton'))}</span>
          </button>
          ${ssoEnabled && passwordLoginEnabled ? `
          <div class="auth-divider">${esc(t('login.orDivider'))}</div>
          <a href="/api/v1/auth/oidc/start" class="btn btn--secondary auth-form__submit">${esc(t('login.loginWithSso'))}</a>
          ` : ''}
          <p class="auth-form__forgot" hidden>
            <a href="/forgot-password" data-link>${esc(t('login.forgotPassword'))}</a>
          </p>
        </form>
      </div>
      <p class="auth-version" id="auth-version"></p>
    </main>
  `);





  if (new URLSearchParams(location.search).has('two_factor')) {

    history.replaceState(null, '', location.pathname);
    renderSecondFactor(container, { recoveryAvailable: true });
    return;
  }

  const form = container.querySelector('#auth-form');
  const errorEl = container.querySelector('#form-error');
  const submitBtn = container.querySelector('#auth-btn');

  container.querySelectorAll('a[data-link]').forEach((a) =>
    a.addEventListener('click', (e) => { e.preventDefault(); window.aashiyana.navigate(a.getAttribute('href')); }));


  const urlParams = new URLSearchParams(window.location.search);
  const ssoError = urlParams.get('error');
  if (ssoError?.startsWith('oidc_')) {




    showError(errorEl, ssoError === 'oidc_signup_disabled'
      ? t('login.ssoNoAccount')
      : t('login.ssoError'));
  }






  container.querySelector('#show-password-form')?.addEventListener('click', (e) => {
    const form = container.querySelector('#auth-form');
    if (form) form.hidden = false;
    e.currentTarget.closest('p')?.remove();
    form?.querySelector('#username')?.focus();
  });

  // K3: Passwort-Sichtbarkeits-Toggle
  const passwordInput = form.querySelector('#password');
  const passwordWrapper = document.createElement('div');
  passwordWrapper.className = 'input-password-wrapper';
  passwordInput.parentNode.insertBefore(passwordWrapper, passwordInput);
  passwordWrapper.appendChild(passwordInput);

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'password-toggle';
  toggleBtn.setAttribute('aria-label', t('login.showPassword'));
  const toggleIcon = document.createElement('i');
  toggleIcon.setAttribute('data-lucide', 'eye');
  toggleIcon.setAttribute('aria-hidden', 'true');
  toggleBtn.appendChild(toggleIcon);
  passwordWrapper.appendChild(toggleBtn);
  if (window.lucide) lucide.createIcons({ el: toggleBtn });

  toggleBtn.addEventListener('click', () => {
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    toggleIcon.setAttribute('data-lucide', isPassword ? 'eye-off' : 'eye');
    toggleBtn.setAttribute('aria-label', t(isPassword ? 'login.hidePassword' : 'login.showPassword'));
    if (window.lucide) lucide.createIcons({ el: toggleBtn });
  });



  const capslockEl = container.querySelector('#auth-capslock');
  if (window.lucide) lucide.createIcons({ el: capslockEl });
  const updateCapsLock = (e) => {
    if (typeof e.getModifierState !== 'function') return;
    capslockEl.hidden = !e.getModifierState('CapsLock');
  };
  passwordInput.addEventListener('keydown', updateCapsLock);
  passwordInput.addEventListener('keyup', updateCapsLock);
  passwordInput.addEventListener('blur', () => { capslockEl.hidden = true; });

  setAppBranding(storedAppName);




  if (window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) {
    container.querySelector('#username').focus();
  }

  hydrateFromVersion(container, storedAppName);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;

    const username = form.username.value.trim();
    const password = form.password.value;

    const usernameInput = form.querySelector('#username');
    const usernameGroup = usernameInput.closest('.form-group');
    const passwordGroup = passwordInput.closest('.form-group');

    usernameGroup.classList.toggle('form-group--error', !username);
    passwordGroup.classList.toggle('form-group--error', !password);
    usernameInput.setAttribute('aria-invalid', String(!username));
    passwordInput.setAttribute('aria-invalid', String(!password));

    if (!username || !password) {

      showError(errorEl, t('login.fillAllFields'));
      if (!username) usernameInput.focus();
      else passwordInput.focus();
      return;
    }

    const labelEl = submitBtn.querySelector('.auth-btn__label');

    submitBtn.disabled = true;
    usernameInput.disabled = true;
    passwordInput.disabled = true;
    labelEl.textContent = t('login.loggingIn');
    const spinner = document.createElement('span');
    spinner.className = 'auth-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    submitBtn.insertBefore(spinner, labelEl);

    try {
      const result = await auth.login(username, password);



      if (result?.twoFactorRequired) {
        renderSecondFactor(container, { recoveryAvailable: result.recoveryAvailable === true });
        return;
      }
      window.aashiyana.navigate('/', result.user);
    } catch (err) {





      //




      // hat.




      if (err.status === 403 && /password login is disabled/i.test(err.message || '')) {
        return render(container);
      }




      let message;
      if (err.status === 429) message = t('login.tooManyAttempts');
      else if (err.status === 401) message = t('login.invalidCredentials');


      else if (err.status === 403) message = t('login.accountCannotSignIn');
      else message = t('login.networkError');
      showError(errorEl, message);

      if (err.status === 401) {


        usernameGroup.classList.add('form-group--error');
        passwordGroup.classList.add('form-group--error');
        usernameInput.setAttribute('aria-invalid', 'true');
        passwordInput.setAttribute('aria-invalid', 'true');
        const forgot = container.querySelector('.auth-form__forgot');
        if (forgot && !forgot.hidden) forgot.classList.add('auth-form__forgot--emphasis');
      }



      errorEl.focus();
    } finally {
      submitBtn.disabled = false;
      usernameInput.disabled = false;
      passwordInput.disabled = false;
      labelEl.textContent = t('login.loginButton');
      spinner.remove();
    }
  });

  form.querySelector('#username').addEventListener('input', (e) => {
    e.currentTarget.closest('.form-group').classList.remove('form-group--error');
    e.currentTarget.removeAttribute('aria-invalid');
  });
  form.querySelector('#password').addEventListener('input', (e) => {
    e.currentTarget.closest('.form-group').classList.remove('form-group--error');
    e.currentTarget.removeAttribute('aria-invalid');
  });
}

function renderSecondFactor(container, { recoveryAvailable }) {
  const card = container.querySelector('.auth-card');
  if (!card) return;

  card.replaceChildren();
  card.insertAdjacentHTML('beforeend', `
    <form class="auth-form" id="two-factor-form" novalidate>
      <p class="auth-form__lead">${esc(t('login.twoFactorLead'))}</p>
      <div class="form-group">
        <label class="label" for="two-factor-code">${esc(t('login.twoFactorCodeLabel'))}</label>
        <input
          class="input auth-form__code"
          type="text"
          id="two-factor-code"
          name="code"
          inputmode="numeric"
          autocomplete="one-time-code"
          autocapitalize="characters"
          spellcheck="false"
          maxlength="24"
          required
          aria-describedby="two-factor-hint"
        >
        <p class="form-hint" id="two-factor-hint">${esc(t(recoveryAvailable ? 'login.twoFactorHintRecovery' : 'login.twoFactorHint'))}</p>
      </div>
      <div class="form-error" id="two-factor-error" role="alert" tabindex="-1" hidden></div>
      <button type="submit" class="btn btn--primary auth-form__submit" id="two-factor-btn">
        <span class="auth-btn__label">${esc(t('login.twoFactorSubmit'))}</span>
      </button>
      <p class="auth-form__forgot">
        <a href="/login" data-link>${esc(t('login.twoFactorCancel'))}</a>
      </p>
    </form>
  `);

  const form   = card.querySelector('#two-factor-form');
  const input  = card.querySelector('#two-factor-code');
  const error  = card.querySelector('#two-factor-error');
  const button = card.querySelector('#two-factor-btn');
  const label  = button.querySelector('.auth-btn__label');

  input.focus();
  input.addEventListener('input', () => {
    error.hidden = true;
    input.removeAttribute('aria-invalid');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;

    const code = input.value.trim();
    if (!code) {
      showError(error, t('login.twoFactorMissing'));
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }

    button.disabled = true;
    input.disabled = true;
    label.textContent = t('login.twoFactorChecking');
    const spinner = document.createElement('span');
    spinner.className = 'auth-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    button.insertBefore(spinner, label);

    try {
      const result = await auth.verifyTwoFactor(code);
      window.aashiyana.navigate('/', result.user);
    } catch (err) {



      let message;
      if (err.status === 429) message = t('login.tooManyAttempts');
      else if (err.status === 401 && /pending/i.test(err.message || '')) message = t('login.twoFactorExpired');
      else if (err.status === 401) message = t('login.twoFactorInvalid');
      else message = t('login.networkError');
      showError(error, message);
      input.setAttribute('aria-invalid', 'true');
      error.focus();
    } finally {
      button.disabled = false;
      input.disabled = false;
      label.textContent = t('login.twoFactorSubmit');
      spinner.remove();
    }
  });
}

function showError(el, message) {
  el.textContent = message;
  el.hidden = false;
}

function hydrateFromVersion(container, storedAppName) {
  fetch(VERSION_URL, { cache: 'no-store' })
    .then((r) => r.json())
    .then((d) => {
      if (d?.app_name) {
        try { localStorage.setItem(APP_NAME_STORAGE_KEY, d.app_name); } catch (_) {}


        if (d.app_name !== storedAppName) setAppBranding(d.app_name);
      }


      if (d?.password_reset_enabled) {
        const forgot = container.querySelector('.auth-form__forgot');
        if (forgot) forgot.hidden = false;
      }
      const versionEl = container.querySelector('#auth-version');
      if (versionEl) {
        versionEl.textContent = d?.version ? t('login.version', { version: d.version }) : '';
      }
    })
    .catch(() => {});
}

function fetchOidcConfig(timeoutMs = 2000) {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); resolve(null); }, timeoutMs);
    fetch('/api/v1/auth/oidc/config', { cache: 'no-store', signal: controller.signal })
      .then((r) => r.json())
      .then((data) => { clearTimeout(timer); resolve(data); })
      .catch(() => { clearTimeout(timer); resolve(null); });
  });
}
