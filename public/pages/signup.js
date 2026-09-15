import { auth } from '/api.js';

export async function render(container) {
  container.innerHTML = `
    <style>
      .signup-page,
      .signup-page * {
        box-sizing: border-box;
      }

      .signup-page {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        min-height: 100vh;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        padding: 16px;
        overflow-y: auto;
        background:
          radial-gradient(circle at 15% 15%, #e8efff 0, transparent 38%),
          radial-gradient(circle at 85% 85%, #eeeaff 0, transparent 38%),
          #f7f8fc;
      }

      .signup-shell {
        width: 100%;
        max-width: 350px;
        margin: 0 auto !important;
      }

      .signup-brand {
        text-align: center;
        margin-bottom: 12px;
      }

      .signup-brand-icon {
        width: 40px;
        height: 40px;
        margin: 0 auto 6px;
        border-radius: 11px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #111827;
        color: white;
        font-size: 19px;
        box-shadow: 0 7px 18px rgba(0,0,0,.14);
      }

      .signup-brand h1 {
        margin: 0;
        font-size: 21px;
        line-height: 1.2;
        font-weight: 800;
        color: #111827;
      }

      .signup-brand p {
        margin: 3px 0 0;
        font-size: 11px;
        color: #6b7280;
      }

      .signup-card {
        width: 100%;
        padding: 18px;
        background: #fff;
        border: 1px solid #e5e7eb;
        border-radius: 15px;
        box-shadow: 0 12px 30px rgba(15,23,42,.10);
      }

      .signup-card-title {
        margin: 0 0 13px;
        text-align: center;
        font-size: 17px;
        font-weight: 750;
        color: #111827;
      }

      .signup-form {
        display: flex;
        flex-direction: column;
        gap: 9px;
      }

      .signup-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .signup-field label {
        font-size: 11px;
        font-weight: 700;
        color: #374151;
      }

      .signup-input {
        width: 100%;
        height: 38px;
        padding: 0 10px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        background: #fff;
        color: #111827;
        font-size: 12px;
        outline: none;
      }

      .signup-input:focus {
        border-color: #6366f1;
        box-shadow: 0 0 0 3px rgba(99,102,241,.10);
      }

      .signup-password {
        position: relative;
      }

      .signup-password .signup-input {
        padding-right: 58px;
      }

      .signup-show {
        position: absolute;
        right: 7px;
        top: 50%;
        transform: translateY(-50%);
        border: 0;
        background: transparent;
        color: #4f46e5;
        font-size: 10px;
        font-weight: 700;
        cursor: pointer;
      }

      .signup-error {
        display: none;
        padding: 7px 9px;
        border-radius: 7px;
        background: #fef2f2;
        border: 1px solid #fecaca;
        color: #b91c1c;
        font-size: 10px;
        line-height: 1.35;
      }

      .signup-submit {
        width: 100%;
        height: 40px;
        margin-top: 2px;
        border: 0;
        border-radius: 8px;
        background: #111827;
        color: white;
        font-size: 12px;
        font-weight: 750;
        cursor: pointer;
      }

      .signup-submit:hover {
        background: #1f2937;
      }

      .signup-submit:disabled {
        opacity: .6;
        cursor: not-allowed;
      }

      .signup-footer {
        margin-top: 12px;
        text-align: center;
        font-size: 11px;
        color: #6b7280;
      }

      .signup-footer a {
        color: #4f46e5;
        font-weight: 700;
        text-decoration: none;
      }

      @media (max-height: 650px) {
        .signup-page {
          align-items: flex-start !important;
          padding-top: 10px;
        }

        .signup-brand {
          margin-bottom: 7px;
        }

        .signup-brand-icon {
          width: 32px;
          height: 32px;
          font-size: 16px;
          margin-bottom: 3px;
        }

        .signup-brand h1 {
          font-size: 18px;
        }

        .signup-brand p {
          display: none;
        }

        .signup-card {
          padding: 13px 15px;
        }

        .signup-form {
          gap: 6px;
        }

        .signup-input {
          height: 34px;
        }

        .signup-submit {
          height: 36px;
        }
      }
    </style>

    <div class="signup-page">
      <div class="signup-shell">

        <div class="signup-brand">
          <div class="signup-brand-icon">🏠</div>
          <h1>Aashiyana</h1>
          <p>Your private family space</p>
        </div>

        <div class="signup-card">
          <h2 class="signup-card-title">Create Account</h2>

          <form class="signup-form" id="signupForm">

            <div class="signup-field">
              <label>Username</label>
              <input
                class="signup-input"
                name="username"
                type="text"
                autocomplete="username"
                placeholder="Choose a username"
                required
              />
            </div>

            <div class="signup-field">
              <label>Display Name</label>
              <input
                class="signup-input"
                name="display_name"
                type="text"
                autocomplete="name"
                placeholder="Your name"
                required
              />
            </div>

            <div class="signup-field">
              <label>Password</label>
              <div class="signup-password">
                <input
                  id="signupPassword"
                  class="signup-input"
                  name="password"
                  type="password"
                  autocomplete="new-password"
                  placeholder="Minimum 8 characters"
                  required
                />
                <button type="button" class="signup-show" id="showPassword">
                  Show
                </button>
              </div>
            </div>

            <div class="signup-field">
              <label>Confirm Password</label>
              <div class="signup-password">
                <input
                  id="confirmPassword"
                  class="signup-input"
                  name="confirm_password"
                  type="password"
                  autocomplete="new-password"
                  placeholder="Re-enter your password"
                  required
                />
                <button type="button" class="signup-show" id="showConfirm">
                  Show
                </button>
              </div>
            </div>

            <div class="signup-error" id="signupError"></div>

            <button type="submit" class="signup-submit" id="signupSubmit">
              Create Account
            </button>

          </form>

          <div class="signup-footer">
            Already have an account?
            <a href="/login" data-link>Login</a>
          </div>
        </div>

      </div>
    </div>
  `;

  const form = container.querySelector('#signupForm');
  const password = container.querySelector('#signupPassword');
  const confirmPassword = container.querySelector('#confirmPassword');
  const showPassword = container.querySelector('#showPassword');
  const showConfirm = container.querySelector('#showConfirm');
  const submitButton = container.querySelector('#signupSubmit');
  const errorBox = container.querySelector('#signupError');

  showPassword.addEventListener('click', () => {
    const hidden = password.type === 'password';
    password.type = hidden ? 'text' : 'password';
    showPassword.textContent = hidden ? 'Hide' : 'Show';
  });

  showConfirm.addEventListener('click', () => {
    const hidden = confirmPassword.type === 'password';
    confirmPassword.type = hidden ? 'text' : 'password';
    showConfirm.textContent = hidden ? 'Hide' : 'Show';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    errorBox.style.display = 'none';
    errorBox.textContent = '';

    const username = form.username.value.trim();
    const displayName = form.display_name.value.trim();
    const passwordValue = form.password.value;
    const confirmValue = form.confirm_password.value;

    if (passwordValue !== confirmValue) {
      errorBox.textContent = 'Passwords do not match.';
      errorBox.style.display = 'block';
      return;
    }

    if (passwordValue.length < 8) {
      errorBox.textContent = 'Password must be at least 8 characters long.';
      errorBox.style.display = 'block';
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Creating...';

    try {
      await auth.signup(username, displayName, passwordValue);
      window.location.href = '/login';
    } catch (error) {
      errorBox.textContent =
        error?.message || 'Unable to create account. Please try again.';
      errorBox.style.display = 'block';

      submitButton.disabled = false;
      submitButton.textContent = 'Create Account';
    }
  });
}
