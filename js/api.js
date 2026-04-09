// js/api.js — Google Sheets API client (OAuth 2.0)
import { CONFIG } from './config.js';
import { getAccessToken } from './auth.js';

/**
 * Structured error thrown for all API failures.
 * @property {string} code    - Machine-readable error code
 * @property {string} message - Human-readable description
 */
export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.message = message;
  }
}

const TIMEOUT_MS = 10_000;
const BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets';

// ─── Retry with exponential backoff ──────────────────────────────────────────
const MAX_RETRIES = 4;
const RETRY_BASE_MS = 1000; // 1s, 2s, 4s, 8s

/**
 * Runs fn(), retrying on HTTP 429 (rate limit) with exponential backoff.
 * @param {() => Promise<Response>} fn
 * @returns {Promise<Response>}
 */
async function withRetry(fn) {
  let attempt = 0;
  while (true) {
    const response = await fn();
    if (response.status !== 429 || attempt >= MAX_RETRIES) return response;
    const delay = RETRY_BASE_MS * Math.pow(2, attempt);
    await new Promise(r => setTimeout(r, delay));
    attempt++;
  }
}

/**
 * fetch() wrapper that auto-cancels after TIMEOUT_MS.
 */
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Builds request headers with a fresh Bearer token.
 * @param {object} [extra] - Additional headers to merge
 */
async function authHeaders(extra = {}) {
  const token = await getAccessToken();
  return { Authorization: `Bearer ${token}`, ...extra };
}

/**
 * Appends a single row to the given sheet.
 * @param {string}   sheetName
 * @param {string[]} rowValues
 */
export async function appendRow(sheetName, rowValues) {
  const { spreadsheetId } = CONFIG;
  const range = encodeURIComponent(`${sheetName}!A1`);
  const url =
    `${BASE_URL}/${spreadsheetId}/values/${range}:append` +
    `?valueInputOption=USER_ENTERED`;

  let response;
  try {
    const headers = await authHeaders({ 'Content-Type': 'application/json' });
    response = await withRetry(() => fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ values: [rowValues] }),
    }));
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ApiError('TIMEOUT', 'Request timed out after 10 seconds.');
    }
    throw new ApiError('NETWORK_ERROR', err.message || 'Network request failed.');
  }

  if (response.status === 401) {
    throw new ApiError('UNAUTHORIZED', 'Session expired. Please sign in again.');
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body?.error?.message || detail;
    } catch (_) { /* ignore */ }
    throw new ApiError(`HTTP_${response.status}`, `Sheets API error ${response.status}: ${detail}`);
  }
}

/**
 * Fetches all rows from the given sheet.
 * @param {string} sheetName
 * @returns {Promise<string[][]>}
 */
export async function fetchRows(sheetName) {
  const { spreadsheetId } = CONFIG;
  const range = encodeURIComponent(sheetName);
  const url = `${BASE_URL}/${spreadsheetId}/values/${range}`;

  let response;
  try {
    const headers = await authHeaders();
    response = await withRetry(() => fetchWithTimeout(url, { headers }));
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ApiError('TIMEOUT', 'Request timed out after 10 seconds.');
    }
    throw new ApiError('NETWORK_ERROR', err.message || 'Network request failed.');
  }

  if (response.status === 401) {
    throw new ApiError('UNAUTHORIZED', 'Session expired. Please sign in again.');
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body?.error?.message || detail;
    } catch (_) { /* ignore */ }
    throw new ApiError(`HTTP_${response.status}`, `Sheets API error ${response.status}: ${detail}`);
  }

  const data = await response.json();
  return data.values ?? [];
}

/**
 * Overwrites an entire sheet with the given rows (used for delete operations).
 * Clears the sheet first, then writes all rows back.
 * @param {string}     sheetName
 * @param {string[][]} rows  - All rows to write (empty array clears the sheet)
 */
export async function writeAllRows(sheetName, rows) {
  const { spreadsheetId } = CONFIG;
  const range = encodeURIComponent(sheetName);

  // 1. Clear the sheet
  const clearUrl = `${BASE_URL}/${spreadsheetId}/values/${range}:clear`;
  let clearResp;
  try {
    const clearHeaders = await authHeaders({ 'Content-Type': 'application/json' });
    clearResp = await withRetry(() => fetchWithTimeout(clearUrl, {
      method: 'POST',
      headers: clearHeaders,
    }));
  } catch (err) {
    if (err.name === 'AbortError') throw new ApiError('TIMEOUT', 'Request timed out.');
    throw new ApiError('NETWORK_ERROR', err.message || 'Network request failed.');
  }
  if (clearResp.status === 401) throw new ApiError('UNAUTHORIZED', 'Session expired.');
  if (!clearResp.ok) {
    let detail = clearResp.statusText;
    try { const b = await clearResp.json(); detail = b?.error?.message || detail; } catch (_) {}
    throw new ApiError(`HTTP_${clearResp.status}`, `Sheets API error ${clearResp.status}: ${detail}`);
  }

  // 2. Write rows back (skip if empty)
  if (rows.length === 0) return;

  const updateUrl =
    `${BASE_URL}/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`;
  let updateResp;
  try {
    const updateHeaders = await authHeaders({ 'Content-Type': 'application/json' });
    updateResp = await withRetry(() => fetchWithTimeout(updateUrl, {
      method: 'PUT',
      headers: updateHeaders,
      body: JSON.stringify({ values: rows }),
    }));
  } catch (err) {
    if (err.name === 'AbortError') throw new ApiError('TIMEOUT', 'Request timed out.');
    throw new ApiError('NETWORK_ERROR', err.message || 'Network request failed.');
  }
  if (updateResp.status === 401) throw new ApiError('UNAUTHORIZED', 'Session expired.');
  if (!updateResp.ok) {
    let detail = updateResp.statusText;
    try { const b = await updateResp.json(); detail = b?.error?.message || detail; } catch (_) {}
    throw new ApiError(`HTTP_${updateResp.status}`, `Sheets API error ${updateResp.status}: ${detail}`);
  }
}
