// js/login.js — Login page controller
import { initAuth, getAccessToken, isSignedIn } from './auth.js';

let _loading = false;

function _showError(message) {
  const errorEl = document.getElementById('login-error');
  const msgEl = document.getElementById('login-error-message');
  msgEl.textContent = message;
  errorEl.classList.remove('d-none');
  document.getElementById('sign-in-btn').setAttribute('aria-describedby', 'login-error');
}

function _clearError() {
  const errorEl = document.getElementById('login-error');
  const msgEl = document.getElementById('login-error-message');
  errorEl.classList.add('d-none');
  msgEl.textContent = '';
  document.getElementById('sign-in-btn').removeAttribute('aria-describedby');
}

function _mapError(err) {
  if (err.message === 'popup_closed_by_user') {
    return "Sign-in was cancelled. You can try again whenever you're ready.";
  }
  const msg = err.message?.toLowerCase() ?? '';
  if (msg.includes('failed to load') || msg.includes('check your internet')) {
    return 'Could not load Google Sign-In. Please check your internet connection.';
  }
  return `Sign-in failed: ${err.message}. Please try again.`;
}

export async function initLoginPage() {
  await initAuth();

  const loginPage = document.getElementById('login-page');
  const appContent = document.getElementById('app-content');
  const signInBtn = document.getElementById('sign-in-btn');
  const spinner = document.getElementById('login-spinner');

  // Initial view
  if (isSignedIn()) {
    loginPage.classList.add('d-none');
    appContent.style.display = '';
  } else {
    loginPage.classList.remove('d-none');
    appContent.style.display = 'none';
  }

  // Sign-in button click
  signInBtn.addEventListener('click', async () => {
    _loading = true;
    signInBtn.disabled = true;
    spinner.classList.remove('d-none');
    _clearError();

    try {
      await getAccessToken(false);
      // Success: auth:signedIn listener handles the transition
    } catch (err) {
      _showError(_mapError(err));
      _loading = false;
      signInBtn.disabled = false;
      spinner.classList.add('d-none');
    }
  });

  // Dismiss error button
  const dismissBtn = document.querySelector('#login-error .btn-close');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => _clearError());
  }

  // auth:signedIn
  document.addEventListener('auth:signedIn', () => {
    loginPage.classList.add('d-none');
    appContent.style.display = '';
    _loading = false;
    spinner.classList.add('d-none');
    signInBtn.disabled = false;
  });

  // auth:signedOut
  document.addEventListener('auth:signedOut', () => {
    loginPage.classList.remove('d-none');
    appContent.style.display = 'none';
    _clearError();
    _loading = false;
    signInBtn.disabled = false;
    spinner.classList.add('d-none');
  });
}
