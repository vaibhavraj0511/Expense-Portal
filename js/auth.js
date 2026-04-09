// js/auth.js — Google Identity Services token client
// Scope: Google Sheets read/write
import { CONFIG } from './config.js';

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

let _tokenClient = null;
let _accessToken   = null;
let _tokenExpiry   = 0;

/**
 * Wait for GIS (Google Identity Services) to be ready.
 */
function waitForGIS() {
  return new Promise((resolve) => {
    if (typeof google !== 'undefined' && google.accounts) {
      resolve();
    } else {
      const interval = setInterval(() => {
        if (typeof google !== 'undefined' && google.accounts) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    }
  });
}

/**
 * Initialises the token client once.  Must be called before getAccessToken().
 */
export async function initAuth() {
  await waitForGIS();

  if (!CONFIG.clientId) {
    console.warn('[auth] clientId is not set in config.js — OAuth will not work.');
    return;
  }

  _tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.clientId,
    scope: SCOPE,
    callback: (response) => {
      if (response.error) {
        console.error('[auth] token error:', response.error);
        return;
      }
      const expiry = Date.now() + (response.expires_in - 60) * 1000;
      _persistToken(response.access_token, expiry);
      document.dispatchEvent(new CustomEvent('auth:signedIn'));
    },
  });
}

/**
 * Get current access token (from cache or prompt user).
 */
export function getAccessToken(silent = false) {
  return new Promise(async (resolve, reject) => {
    try { await waitForGIS(); } catch (err) { reject(err); return; }

    if (_accessToken && Date.now() < _tokenExpiry) {
      resolve(_accessToken);
      return;
    }

    if (!_tokenClient) {
      reject(new Error('Auth not initialised. Call initAuth() first.'));
      return;
    }

    _tokenClient.callback = (response) => {
      if (response.error) {
        reject(new Error(response.error));
        return;
      }
      const expiry = Date.now() + (response.expires_in - 60) * 1000;
      _persistToken(response.access_token, expiry);
      document.dispatchEvent(new CustomEvent('auth:signedIn'));
      resolve(_accessToken);
    };

    _tokenClient.requestAccessToken({ prompt: silent ? '' : 'consent' });
  });
}

/**
 * Returns true if a non-expired token is currently held.
 */
export function isSignedIn() {
  return Boolean(_accessToken) && Date.now() < _tokenExpiry;
}

/**
 * Revokes the current token and clears local state.
 */
export function signOut() {
  if (_accessToken) {
    google.accounts.oauth2.revoke(_accessToken, () => {});
  }
  _clearToken();
  document.dispatchEvent(new CustomEvent('auth:signedOut'));
}

function _persistToken(token, expiry) {
  _accessToken = token;
  _tokenExpiry = expiry;
  try {
    sessionStorage.setItem('gat', JSON.stringify({ token, expiry }));
  } catch (_) {}
}

function _clearToken() {
  _accessToken = null;
  _tokenExpiry = 0;
  try { sessionStorage.removeItem('gat'); } catch (_) {}
}

// Restore token from session storage on page load
try {
  const saved = JSON.parse(sessionStorage.getItem('gat') || 'null');
  if (saved && saved.expiry > Date.now()) {
    _accessToken = saved.token;
    _tokenExpiry = saved.expiry;
  }
} catch (_) {}
