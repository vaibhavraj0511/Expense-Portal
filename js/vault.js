// js/vault.js — Personal Vault: credentials, notes, lists, reminders, custom sections

import { CONFIG } from './config.js';
import { fetchRows, writeAllRows } from './api.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const SHEET = CONFIG.sheets.vault;

export const SECTION_TYPES = {
  credential: { label: 'Credentials', icon: 'bi-key-fill',      color: '#f59e0b' },
  note:       { label: 'Note',        icon: 'bi-journal-text',   color: '#6366f1' },
  todo:       { label: 'To-Do List',  icon: 'bi-check2-square',  color: '#10b981' },
  list:       { label: 'List',        icon: 'bi-list-check',     color: '#3b82f6' },
  reminder:   { label: 'Reminder',    icon: 'bi-alarm-fill',     color: '#ef4444' },
  custom:     { label: 'Custom',      icon: 'bi-puzzle-fill',    color: '#8b5cf6' },
};

// ─── Serialization ────────────────────────────────────────────────────────────
// Columns: id | sectionId | sectionName | sectionType | fieldKey | fieldValue | extra | createdAt | updatedAt
function serialize(row) {
  return [row.id, row.sectionId, row.sectionName, row.sectionType, row.fieldKey, row.fieldValue, row.extra ?? '', row.createdAt, row.updatedAt];
}
function deserialize(r) {
  return { id: r[0]??'', sectionId: r[1]??'', sectionName: r[2]??'', sectionType: r[3]??'custom', fieldKey: r[4]??'', fieldValue: r[5]??'', extra: r[6]??'', createdAt: r[7]??'', updatedAt: r[8]??'' };
}

// ─── Base64 obfuscation ───────────────────────────────────────────────────────
function obfuscate(str)   { try { return btoa(unescape(encodeURIComponent(str))); }   catch { return str; } }
function deobfuscate(str) { try { return decodeURIComponent(escape(atob(str))); } catch { return str; } }

// ─── Password strength ────────────────────────────────────────────────────────
function _pwdStrength(pwd) {
  if (!pwd) return { score: 0, label: '', color: '' };
  let score = 0;
  if (pwd.length >= 8)  score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  const levels = [
    { label: 'Very Weak', color: '#ef4444' },
    { label: 'Weak',      color: '#f97316' },
    { label: 'Fair',      color: '#eab308' },
    { label: 'Good',      color: '#84cc16' },
    { label: 'Strong',    color: '#10b981' },
    { label: 'Very Strong', color: '#06b6d4' },
  ];
  return { score, ...levels[Math.min(score, 5)] };
}

// ─── In-memory state ──────────────────────────────────────────────────────────
let _rows = [];
let _loaded = false;
let _searchQuery = '';
let _sectionOrder = [];
let _activeTab = 'all'; // 'all' | section type key
let _pageState = {};    // { [tabKey]: pageIndex } — 0-based
const PAGE_SIZE = 3;    // sections per page
// pending modal actions
let _pendingDeleteSection = null; // sectionId
let _pendingDeleteCred    = null; // { sectionId, entryId, platform }
let _pendingRename        = null; // sectionId

// ─── API helpers ──────────────────────────────────────────────────────────────
async function _load() {
  const raw = await fetchRows(SHEET);
  _rows = raw.map(deserialize).filter(r => r.id && r.fieldKey !== '_meta');
  // Build initial order from appearance
  const seen = new Set();
  _sectionOrder = [];
  for (const r of _rows) {
    if (!seen.has(r.sectionId)) { seen.add(r.sectionId); _sectionOrder.push(r.sectionId); }
  }
  _loaded = true;
}

async function _save() {
  await writeAllRows(SHEET, _rows.map(serialize));
}

function _now()  { return new Date().toISOString(); }
function _uuid() { return crypto.randomUUID(); }

// ─── Section helpers ──────────────────────────────────────────────────────────
function _getSections() {
  const map = new Map();
  for (const r of _rows) {
    if (!map.has(r.sectionId))
      map.set(r.sectionId, { id: r.sectionId, name: r.sectionName, type: r.sectionType });
  }
  // Return in _sectionOrder, append any not yet in order list
  const ordered = _sectionOrder.filter(id => map.has(id)).map(id => map.get(id));
  for (const [id, sec] of map) { if (!_sectionOrder.includes(id)) ordered.push(sec); }
  return ordered;
}

function _getRowsForSection(sectionId) {
  return _rows.filter(r => r.sectionId === sectionId);
}

// ─── Overdue reminder count (for nav badge) ───────────────────────────────────
function _countOverdue() {
  const today = new Date().toISOString().slice(0, 10);
  return _rows.filter(r => r.sectionType === 'reminder' && r.extra && r.extra < today && r.fieldKey !== 'done').length;
}

function _updateNavBadge() {
  const count = _countOverdue();
  document.querySelectorAll('[data-tab="tab-vault"] .vault-nav-badge').forEach(el => {
    el.textContent = count;
    el.style.display = count > 0 ? 'inline-flex' : 'none';
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

// ─── Credential section ───────────────────────────────────────────────────────
function _renderCredentialSection(section, rows) {
  const entryMap = new Map();
  for (const r of rows) {
    if (!r.extra) continue;
    if (!entryMap.has(r.extra)) entryMap.set(r.extra, { _entryId: r.extra });
    entryMap.get(r.extra)[r.fieldKey] = r.fieldValue;
  }

  let html = `<div class="vault-cred-list">`;
  if (entryMap.size === 0) html += `<p class="vault-empty">No credentials yet. Click + Add.</p>`;

  for (const [entryId, entry] of entryMap) {
    const days = _daysSince(entry.lastChanged);
    let daysCls = 'vault-days-ok', daysLabel = '';
    if (days !== null) {
      if (days > 90)      { daysCls = 'vault-days-warn'; }
      else if (days > 60) { daysCls = 'vault-days-mid';  }
      daysLabel = `<span class="vault-days-badge ${daysCls}" title="Password last changed">${days}d ago</span>`;
    }
    const decodedPwd = deobfuscate(entry.password ?? '');
    html += `
    <div class="vault-cred-card" data-entry-id="${esc(entryId)}" data-section-id="${esc(section.id)}">
      <div class="vault-cred-header">
        <i class="bi bi-globe2 text-muted me-1"></i>
        <span class="vault-cred-platform">${esc(entry.platform ?? '')}</span>
        ${daysLabel}
        <div class="vault-cred-actions ms-auto">
          <button class="vault-btn-icon vault-edit-cred" data-entry-id="${esc(entryId)}" data-section-id="${esc(section.id)}" title="Edit"><i class="bi bi-pencil-fill"></i></button>
          <button class="vault-btn-icon text-danger vault-delete-cred" data-entry-id="${esc(entryId)}" data-section-id="${esc(section.id)}" title="Delete"><i class="bi bi-trash3-fill"></i></button>
        </div>
      </div>
      <div class="vault-cred-fields">
        <div class="vault-cred-row">
          <span class="vault-cred-label">Username</span>
          <span class="vault-cred-val">
            <span>${esc(entry.username ?? '')}</span>
            <button class="vault-btn-icon vault-copy" data-copy="${esc(entry.username ?? '')}" title="Copy username"><i class="bi bi-clipboard"></i></button>
          </span>
        </div>
        <div class="vault-cred-row">
          <span class="vault-cred-label">Password</span>
          <span class="vault-cred-val">
            <span class="vault-pwd-mask" data-pwd="${esc(decodedPwd)}">••••••••</span>
            <button class="vault-btn-icon vault-eye" title="Show/Hide"><i class="bi bi-eye-fill"></i></button>
            <button class="vault-btn-icon vault-copy" data-copy="${esc(decodedPwd)}" title="Copy password"><i class="bi bi-clipboard"></i></button>
          </span>
        </div>
        ${entry.url ? `<div class="vault-cred-row"><span class="vault-cred-label">URL</span><span class="vault-cred-val"><a href="${esc(entry.url)}" target="_blank" class="vault-cred-link">${esc(entry.url)}</a></span></div>` : ''}
        ${entry.notes ? `<div class="vault-cred-row"><span class="vault-cred-label">Notes</span><span class="vault-cred-val text-muted">${esc(entry.notes)}</span></div>` : ''}
      </div>
    </div>`;
  }

  html += `<button class="vault-add-btn mt-2" data-action="add-cred" data-section-id="${esc(section.id)}"><i class="bi bi-plus-lg"></i>Add Credential</button></div>`;
  return html;
}

// ─── List / To-Do section ─────────────────────────────────────────────────────
function _renderListSection(section, rows, type) {
  let html = `<div class="vault-list-wrap">`;
  if (rows.length === 0) html += `<p class="vault-empty">Empty list. Add items below.</p>`;
  for (const r of rows) {
    const done = r.extra === 'done';
    html += `
    <div class="vault-list-item ${done ? 'vault-list-done' : ''}" data-row-id="${esc(r.id)}">
      <input type="checkbox" class="vault-check" data-row-id="${esc(r.id)}" ${done ? 'checked' : ''}>
      <span class="vault-list-text">${esc(r.fieldValue)}</span>
      <button class="vault-btn-icon text-danger vault-delete-row ms-auto" data-row-id="${esc(r.id)}" title="Delete"><i class="bi bi-x-lg"></i></button>
    </div>`;
  }
  html += `
  <div class="vault-add-item-row mt-2">
    <input type="text" class="vault-input vault-new-item-input" placeholder="Add item…" data-section-id="${esc(section.id)}">
    <button class="vault-add-btn vault-add-list-item" data-section-id="${esc(section.id)}"><i class="bi bi-plus-lg"></i></button>
  </div></div>`;
  return html;
}

// ─── Reminder section ─────────────────────────────────────────────────────────
function _renderReminderSection(section, rows) {
  const today = new Date().toISOString().slice(0, 10);
  let html = `<div class="vault-reminder-wrap">`;
  if (rows.length === 0) html += `<p class="vault-empty">No reminders yet.</p>`;
  for (const r of rows) {
    const due = r.extra;
    const isDone = r.fieldKey === 'done';
    const isOverdue  = due && due < today && !isDone;
    const isDueToday = due === today && !isDone;
    html += `
    <div class="vault-reminder-item ${isOverdue ? 'vault-overdue' : ''} ${isDueToday ? 'vault-due-today' : ''}" data-row-id="${esc(r.id)}">
      <input type="checkbox" class="vault-check" data-row-id="${esc(r.id)}" ${isDone ? 'checked' : ''}>
      <div class="vault-reminder-body">
        <div class="vault-reminder-text">${esc(r.fieldValue)}</div>
        ${due ? `<div class="vault-reminder-due">${isOverdue ? '⚠️ Overdue: ' : isDueToday ? '🔔 Today: ' : '📅 '}${due}</div>` : ''}
      </div>
      <button class="vault-btn-icon text-danger vault-delete-row ms-auto" data-row-id="${esc(r.id)}" title="Delete"><i class="bi bi-x-lg"></i></button>
    </div>`;
  }
  html += `
  <div class="vault-reminder-add">
    <input type="text" class="vault-input vault-new-item-input" placeholder="Reminder text…" data-section-id="${esc(section.id)}">
    <div class="vault-reminder-add-bottom">
      <input type="date" class="vault-input vault-new-reminder-date" style="flex:1">
      <button class="vault-add-btn vault-add-list-item" data-section-id="${esc(section.id)}" data-is-reminder="1"><i class="bi bi-plus-lg"></i>Add</button>
    </div>
  </div></div>`;
  return html;
}

// ─── Note / Custom section ────────────────────────────────────────────────────
function _renderNoteSection(section, rows) {
  const row = rows[0];
  const content = row?.fieldValue ?? '';
  const savedAt = row?.updatedAt ? new Date(row.updatedAt).toLocaleString() : '';
  return `
  <div class="vault-note-wrap">
    <textarea class="vault-textarea" data-section-id="${esc(section.id)}" placeholder="Write your notes here…" rows="6">${esc(content)}</textarea>
    <div class="vault-autosave-bar">
      <span class="vault-autosave-dot" id="vad-${esc(section.id)}"></span>
      <span class="vault-autosave-status" id="vas-${esc(section.id)}">${savedAt ? 'Saved ' + savedAt : 'Not yet saved'}</span>
    </div>
  </div>`;
}

// ─── Section content dispatcher ───────────────────────────────────────────────
function _renderSectionContent(section) {
  const rows = _getRowsForSection(section.id);
  const type = section.type;
  if (type === 'credential') return _renderCredentialSection(section, rows);
  if (type === 'todo' || type === 'list') return _renderListSection(section, rows, type);
  if (type === 'reminder') return _renderReminderSection(section, rows);
  return _renderNoteSection(section, rows);
}

// ─── Build type-tab counts ────────────────────────────────────────────────────
function _tabCounts(allSections) {
  const counts = { all: allSections.length };
  for (const t of Object.keys(SECTION_TYPES)) {
    counts[t] = allSections.filter(s => s.type === t).length;
  }
  return counts;
}

// ─── Render one section card ──────────────────────────────────────────────────
function _renderSectionCard(sec) {
  const cfg = SECTION_TYPES[sec.type] ?? SECTION_TYPES.custom;
  return `
  <div class="vault-section" data-section-id="${esc(sec.id)}" data-type="${esc(sec.type)}">
    <div class="vault-section-header">
      <span class="vault-section-icon-box"><i class="bi ${cfg.icon}"></i></span>
      <span class="vault-section-title">${esc(sec.name)}</span>
      <span class="vault-section-type-badge">${esc(cfg.label)}</span>
      <div class="vault-section-actions ms-auto">
        <button class="vault-btn-icon vault-collapse-section" data-section-id="${esc(sec.id)}" title="Collapse/Expand"><i class="bi bi-chevron-up"></i></button>
        <div class="vault-kebab-menu">
          <button class="vault-btn-icon vault-kebab-toggle" data-section-id="${esc(sec.id)}" title="More options"><i class="bi bi-three-dots-vertical"></i></button>
          <div class="vault-kebab-drop">
            <button class="vault-move-up" data-section-id="${esc(sec.id)}"><i class="bi bi-arrow-up"></i>Move Up</button>
            <button class="vault-move-down" data-section-id="${esc(sec.id)}"><i class="bi bi-arrow-down"></i>Move Down</button>
            <button class="vault-rename-section" data-section-id="${esc(sec.id)}" data-section-name="${esc(sec.name)}"><i class="bi bi-pencil-fill"></i>Rename</button>
            <button class="vault-delete-section text-danger" data-section-id="${esc(sec.id)}"><i class="bi bi-trash3-fill"></i>Delete</button>
          </div>
        </div>
      </div>
    </div>
    <div class="vault-section-body" id="vsb-${esc(sec.id)}">
      ${_renderSectionContent(sec)}
    </div>
  </div>`;
}

// ─── Main render ──────────────────────────────────────────────────────────────
function _render() {
  const panel = document.getElementById('vault-panel-body');
  if (!panel) return;

  const allSections = _getSections();

  // Empty vault
  if (allSections.length === 0 && !_searchQuery) {
    panel.innerHTML = `
    <div class="vault-empty-state">
      <i class="bi bi-shield-lock vault-empty-icon"></i>
      <p class="fw-semibold mt-3">Your vault is empty</p>
      <p class="text-muted small">Create a section to store credentials, notes, lists and more.</p>
    </div>`;
    return;
  }

  // Stats bar
  const totalCreds = [...new Set(_rows.filter(r => r.sectionType === 'credential' && r.extra).map(r => r.extra))].length;
  const overdueCount = _countOverdue();
  const statsHtml = `
  <div class="vault-stats">
    <div class="vault-stat-tile vault-stat-sections"><span class="vst-val">${allSections.length}</span><span class="vst-lbl">Sections</span></div>
    <div class="vault-stat-tile vault-stat-creds"><span class="vst-val">${totalCreds}</span><span class="vst-lbl">Credentials</span></div>
    <div class="vault-stat-tile vault-stat-overdue${overdueCount > 0 ? ' has-overdue' : ''}"><span class="vst-val">${overdueCount}</span><span class="vst-lbl">Overdue</span></div>
  </div>`;

  // Type tabs
  const counts = _tabCounts(allSections);
  const tabDefs = [{ key:'all', label:'All', icon:'bi-grid-fill' }, ...Object.entries(SECTION_TYPES).map(([k,v]) => ({ key:k, label:v.label, icon:v.icon }))];
  const tabsHtml = `<div class="vault-type-tabs">${tabDefs.filter(t => t.key === 'all' || counts[t.key] > 0).map(t => `
    <button class="vault-type-tab${_activeTab === t.key ? ' active' : ''}" data-vault-tab="${t.key}">
      <i class="bi ${t.icon}"></i>${t.label}
      ${counts[t.key] > 0 ? `<span class="vault-tab-count">${counts[t.key]}</span>` : ''}
    </button>`).join('')}</div>`;

  // Filter by active tab + search
  let sections = _activeTab === 'all' ? [...allSections] : allSections.filter(s => s.type === _activeTab);
  if (_searchQuery) {
    const q = _searchQuery.toLowerCase();
    sections = sections.filter(sec => {
      if (sec.name.toLowerCase().includes(q)) return true;
      return _getRowsForSection(sec.id).some(r => r.fieldValue.toLowerCase().includes(q));
    });
  }

  if (sections.length === 0) {
    const msg = _searchQuery
      ? `No results for "<strong>${esc(_searchQuery)}</strong>"`
      : `No ${_activeTab === 'all' ? '' : (SECTION_TYPES[_activeTab]?.label ?? _activeTab) + ' '}sections yet.`;
    panel.innerHTML = statsHtml + tabsHtml + `<div class="text-center p-4 text-muted"><i class="bi bi-search fs-3"></i><p class="mt-2">${msg}</p></div>`;
    _bindPanelEvents(panel);
    _updateNavBadge();
    return;
  }

  // Pagination
  const tabKey = _activeTab + (_searchQuery ? '_s' : '');
  if (_pageState[tabKey] === undefined) _pageState[tabKey] = 0;
  const totalPages = Math.ceil(sections.length / PAGE_SIZE);
  _pageState[tabKey] = Math.min(_pageState[tabKey], totalPages - 1);
  const page = _pageState[tabKey];
  const pageSections = sections.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  // Pagination controls
  const pagerHtml = totalPages > 1 ? `
  <div class="vault-pager">
    <button class="vault-pager-btn" data-vault-page="${page - 1}" ${page === 0 ? 'disabled' : ''}>
      <i class="bi bi-chevron-left"></i>
    </button>
    <span class="vault-pager-info">${page + 1} of ${totalPages}</span>
    <button class="vault-pager-btn" data-vault-page="${page + 1}" ${page >= totalPages - 1 ? 'disabled' : ''}>
      <i class="bi bi-chevron-right"></i>
    </button>
  </div>` : '';

  const cardsHtml = `<div class="vault-sections">${pageSections.map(_renderSectionCard).join('')}</div>`;

  panel.innerHTML = statsHtml + tabsHtml + cardsHtml + pagerHtml;
  _bindPanelEvents(panel);
  _updateNavBadge();
}

// ─── Event bindings ───────────────────────────────────────────────────────────
function _bindPanelEvents(panel) {
  // Type tab switching
  panel.querySelectorAll('[data-vault-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeTab = btn.dataset.vaultTab;
      _render();
    });
  });

  // Pagination
  panel.querySelectorAll('[data-vault-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const tabKey = _activeTab + (_searchQuery ? '_s' : '');
      _pageState[tabKey] = parseInt(btn.dataset.vaultPage, 10);
      _render();
      document.getElementById('vault-panel-body')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // Eye toggle
  panel.querySelectorAll('.vault-eye').forEach(btn => {
    btn.addEventListener('click', () => {
      const mask = btn.previousElementSibling;
      const isHidden = mask.textContent === '••••••••';
      mask.textContent = isHidden ? mask.dataset.pwd : '••••••••';
      btn.querySelector('i').className = isHidden ? 'bi bi-eye-slash-fill' : 'bi bi-eye-fill';
    });
  });

  // Copy to clipboard
  panel.querySelectorAll('.vault-copy').forEach(btn => {
    btn.addEventListener('click', async () => {
      const text = btn.dataset.copy;
      try {
        await navigator.clipboard.writeText(text);
        const icon = btn.querySelector('i');
        icon.className = 'bi bi-clipboard-check';
        setTimeout(() => { icon.className = 'bi bi-clipboard'; }, 1500);
        _showToast('Copied to clipboard!');
      } catch { _showToast('Copy failed — please copy manually.'); }
    });
  });

  // Checkbox toggle (list/todo/reminder)
  panel.querySelectorAll('.vault-check').forEach(cb => {
    cb.addEventListener('change', async () => {
      const idx = _rows.findIndex(r => r.id === cb.dataset.rowId);
      if (idx === -1) return;
      _rows[idx].extra = cb.checked ? 'done' : '';
      _rows[idx].fieldKey = cb.checked ? 'done' : 'item';
      _rows[idx].updatedAt = _now();
      await _save();
      _render();
    });
  });

  // Delete row
  panel.querySelectorAll('.vault-delete-row').forEach(btn => {
    btn.addEventListener('click', async () => {
      _rows = _rows.filter(r => r.id !== btn.dataset.rowId);
      await _save();
      _render();
    });
  });

  // Add list / reminder item
  panel.querySelectorAll('.vault-add-list-item').forEach(btn => {
    btn.addEventListener('click', async () => {
      const sectionId = btn.dataset.sectionId;
      const isReminder = btn.dataset.isReminder === '1';
      const wrap = btn.closest('.vault-add-item-row');
      const input = wrap.querySelector('.vault-new-item-input');
      const dateInput = wrap.querySelector('.vault-new-reminder-date');
      const text = input?.value?.trim();
      if (!text) return;
      const sec = _getSections().find(s => s.id === sectionId);
      _rows.push({ id: _uuid(), sectionId, sectionName: sec?.name ?? '', sectionType: sec?.type ?? 'list', fieldKey: 'item', fieldValue: text, extra: isReminder ? (dateInput?.value ?? '') : '', createdAt: _now(), updatedAt: _now() });
      await _save();
      _render();
    });
  });

  // Enter key shortcut for adding items
  panel.querySelectorAll('.vault-new-item-input').forEach(inp => {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const wrap = inp.closest('.vault-add-item-row') || inp.closest('.vault-reminder-add');
        wrap?.querySelector('.vault-add-list-item')?.click();
      }
    });
  });

  // Kebab toggle
  panel.querySelectorAll('.vault-kebab-toggle').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const menu = btn.closest('.vault-kebab-menu');
      const wasOpen = menu.classList.contains('open');
      panel.querySelectorAll('.vault-kebab-menu.open').forEach(m => m.classList.remove('open'));
      if (!wasOpen) menu.classList.add('open');
    });
  });

  // Close kebab on outside click
  document.addEventListener('click', () => {
    panel.querySelectorAll('.vault-kebab-menu.open').forEach(m => m.classList.remove('open'));
  }, { once: false });  // passive listener — OK to run multiple times

  // Autosave note (3s debounce on input)
  panel.querySelectorAll('.vault-textarea').forEach(ta => {
    let _timer = null;
    const sectionId = ta.dataset.sectionId;
    const dot = document.getElementById(`vad-${sectionId}`);
    const statusEl = document.getElementById(`vas-${sectionId}`);
    ta.addEventListener('input', () => {
      if (dot) { dot.className = 'vault-autosave-dot unsaved'; }
      if (statusEl) statusEl.textContent = 'Unsaved changes…';
      clearTimeout(_timer);
      _timer = setTimeout(async () => {
        const content = ta.value;
        const sec = _getSections().find(s => s.id === sectionId);
        const existing = _rows.find(r => r.sectionId === sectionId);
        if (existing) { existing.fieldValue = content; existing.updatedAt = _now(); }
        else { _rows.push({ id: _uuid(), sectionId, sectionName: sec?.name ?? '', sectionType: sec?.type ?? 'note', fieldKey: 'content', fieldValue: content, extra: '', createdAt: _now(), updatedAt: _now() }); }
        await _save();
        if (dot) { dot.className = 'vault-autosave-dot saved'; }
        if (statusEl) statusEl.textContent = 'Saved ' + new Date().toLocaleTimeString();
        _showToast('Note auto-saved!');
      }, 3000);
    });
  });

  // Manual save note (fallback, kept for any direct calls)
  panel.querySelectorAll('.vault-save-note').forEach(btn => {
    btn.addEventListener('click', async () => {
      const sectionId = btn.dataset.sectionId;
      const textarea = btn.closest('.vault-note-wrap')?.querySelector('.vault-textarea');
      const content = textarea?.value ?? '';
      const sec = _getSections().find(s => s.id === sectionId);
      const existing = _rows.find(r => r.sectionId === sectionId);
      if (existing) { existing.fieldValue = content; existing.updatedAt = _now(); }
      else { _rows.push({ id: _uuid(), sectionId, sectionName: sec?.name ?? '', sectionType: sec?.type ?? 'note', fieldKey: 'content', fieldValue: content, extra: '', createdAt: _now(), updatedAt: _now() }); }
      await _save();
      _showToast('Note saved!');
      _render();
    });
  });

  // Collapse/expand section
  panel.querySelectorAll('.vault-collapse-section').forEach(btn => {
    btn.addEventListener('click', () => {
      const body = document.getElementById(`vsb-${btn.dataset.sectionId}`);
      const icon = btn.querySelector('i');
      if (body) {
        body.classList.toggle('d-none');
        icon.className = body.classList.contains('d-none') ? 'bi bi-chevron-down' : 'bi bi-chevron-up';
      }
    });
  });

  // Move section up
  panel.querySelectorAll('.vault-move-up').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.sectionId;
      const i = _sectionOrder.indexOf(id);
      if (i > 0) { [_sectionOrder[i-1], _sectionOrder[i]] = [_sectionOrder[i], _sectionOrder[i-1]]; _render(); }
    });
  });

  // Move section down
  panel.querySelectorAll('.vault-move-down').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.sectionId;
      const i = _sectionOrder.indexOf(id);
      if (i < _sectionOrder.length - 1) { [_sectionOrder[i], _sectionOrder[i+1]] = [_sectionOrder[i+1], _sectionOrder[i]]; _render(); }
    });
  });

  // Delete section
  panel.querySelectorAll('.vault-delete-section').forEach(btn => {
    btn.addEventListener('click', () => {
      const sectionId = btn.dataset.sectionId;
      const sec = _getSections().find(s => s.id === sectionId);
      _pendingDeleteSection = sectionId;
      const modal = document.getElementById('vault-del-section-modal');
      modal.querySelector('#vds-section-name').textContent = `"${sec?.name ?? 'this section'}"` ;
      new bootstrap.Modal(modal).show();
    });
  });

  // Rename section
  panel.querySelectorAll('.vault-rename-section').forEach(btn => {
    btn.addEventListener('click', () => {
      _pendingRename = btn.dataset.sectionId;
      const modal = document.getElementById('vault-rename-modal');
      modal.querySelector('#vault-rename-input').value = btn.dataset.sectionName ?? '';
      new bootstrap.Modal(modal).show();
      setTimeout(() => modal.querySelector('#vault-rename-input').focus(), 300);
    });
  });

  // Add credential
  panel.querySelectorAll('[data-action="add-cred"]').forEach(btn => {
    btn.addEventListener('click', () => _openCredModal(btn.dataset.sectionId, null));
  });

  // Edit credential
  panel.querySelectorAll('.vault-edit-cred').forEach(btn => {
    btn.addEventListener('click', () => _openCredModal(btn.dataset.sectionId, btn.dataset.entryId));
  });

  // Delete credential
  panel.querySelectorAll('.vault-delete-cred').forEach(btn => {
    btn.addEventListener('click', () => {
      const platform = _rows.find(r => r.extra === btn.dataset.entryId && r.fieldKey === 'platform')?.fieldValue ?? 'this credential';
      _pendingDeleteCred = { sectionId: btn.dataset.sectionId, entryId: btn.dataset.entryId };
      const modal = document.getElementById('vault-del-cred-modal');
      modal.querySelector('#vdc-cred-name').textContent = `"${platform}"`;
      new bootstrap.Modal(modal).show();
    });
  });
}

// ─── Credential modal ─────────────────────────────────────────────────────────
function _openCredModal(sectionId, entryId) {
  const modal = document.getElementById('vault-cred-modal');
  if (!modal) return;
  const existing = entryId ? _rows.filter(r => r.sectionId === sectionId && r.extra === entryId) : [];
  const get = key => existing.find(r => r.fieldKey === key)?.fieldValue ?? '';

  modal.querySelector('#vcm-platform').value  = get('platform');
  modal.querySelector('#vcm-username').value  = get('username');
  modal.querySelector('#vcm-password').value  = entryId ? deobfuscate(get('password')) : '';
  modal.querySelector('#vcm-url').value       = get('url');
  modal.querySelector('#vcm-notes').value     = get('notes');
  modal.querySelector('#vcm-last-changed').value = get('lastChanged');
  modal.dataset.sectionId = sectionId;
  modal.dataset.entryId   = entryId ?? '';

  // Reset strength bar
  const bar = modal.querySelector('#vcm-strength-bar');
  const lbl = modal.querySelector('#vcm-strength-label');
  if (bar) { bar.style.width = '0%'; bar.style.background = ''; }
  if (lbl) lbl.textContent = '';

  new bootstrap.Modal(modal).show();
}

// ─── New section modal ────────────────────────────────────────────────────────
function _openNewSectionModal() {
  const modal = document.getElementById('vault-new-section-modal');
  if (!modal) return;
  modal.querySelector('#vns-name').value = '';
  modal.querySelector('#vns-type').value = 'credential';
  new bootstrap.Modal(modal).show();
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function _showToast(msg) {
  const t = document.getElementById('vault-toast');
  if (!t) return;
  t.querySelector('.toast-body').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(t, { delay: 2000 }).show();
}

// ─── Public init ──────────────────────────────────────────────────────────────
export async function init() {
  // Wait for main app loadAllData to finish.
  // Uses a Promise + event-style check so there is zero unnecessary delay —
  // if _appDataReady is already true we resolve immediately.
  function _waitForAppReady() {
    if (window._appDataReady) return Promise.resolve();
    return new Promise(resolve => {
      const POLL_MS = 100;
      const MAX_MS  = 90_000;
      const start   = Date.now();
      const id = setInterval(() => {
        if (window._appDataReady) {
          clearInterval(id);
          resolve();
        } else if (Date.now() - start > MAX_MS) {
          clearInterval(id);
          console.warn('[vault] Timed out waiting for app ready — proceeding anyway');
          resolve();
        }
      }, POLL_MS);
    });
  }

  // Tab click → load + render
  document.querySelectorAll('[data-tab="tab-vault"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!_loaded) {
        document.getElementById('vault-panel-body').innerHTML =
          `<div class="text-center p-5"><div class="spinner-border text-primary"></div><p class="mt-2 text-muted small">Loading vault…</p></div>`;
        try {
          await _waitForAppReady();
          await _load();
        } catch(e) {
          document.getElementById('vault-panel-body').innerHTML =
            `<div class="alert alert-danger m-3">Failed to load vault. Make sure your Google Sheet has a tab named <strong>Vault</strong>.</div>`;
          console.error('[vault] load error', e);
          return;
        }
      }
      _render();
    });
  });

  // Search bar
  document.getElementById('vault-search')?.addEventListener('input', e => {
    _searchQuery = e.target.value.trim();
    if (_loaded) _render();
  });

  // FAB visibility — only show when vault tab is active
  const fab = document.getElementById('vault-fab');
  if (fab) {
    fab.style.display = 'none';
    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        fab.style.display = btn.dataset.tab === 'tab-vault' ? 'inline-flex' : 'none';
      });
    });
    fab.addEventListener('click', _openNewSectionModal);
  }
  document.getElementById('vault-new-section-btn')?.addEventListener('click', _openNewSectionModal);

  // Confirm delete section
  document.getElementById('vault-del-section-confirm')?.addEventListener('click', async () => {
    if (!_pendingDeleteSection) return;
    const sectionId = _pendingDeleteSection;
    _pendingDeleteSection = null;
    bootstrap.Modal.getInstance(document.getElementById('vault-del-section-modal'))?.hide();
    _rows = _rows.filter(r => r.sectionId !== sectionId);
    _sectionOrder = _sectionOrder.filter(id => id !== sectionId);
    await _save();
    _showToast('Section deleted.');
    _render();
  });

  // Confirm delete credential
  document.getElementById('vault-del-cred-confirm')?.addEventListener('click', async () => {
    if (!_pendingDeleteCred) return;
    const { sectionId, entryId } = _pendingDeleteCred;
    _pendingDeleteCred = null;
    bootstrap.Modal.getInstance(document.getElementById('vault-del-cred-modal'))?.hide();
    _rows = _rows.filter(r => !(r.extra === entryId && r.sectionId === sectionId));
    await _save();
    _showToast('Credential deleted.');
    _render();
  });

  // Confirm rename
  document.getElementById('vault-rename-confirm')?.addEventListener('click', async () => {
    if (!_pendingRename) return;
    const newName = document.getElementById('vault-rename-input')?.value?.trim();
    if (!newName) { document.getElementById('vault-rename-input')?.focus(); return; }
    const sectionId = _pendingRename;
    _pendingRename = null;
    bootstrap.Modal.getInstance(document.getElementById('vault-rename-modal'))?.hide();
    _rows = _rows.map(r => r.sectionId === sectionId ? { ...r, sectionName: newName, updatedAt: _now() } : r);
    await _save();
    _showToast('Section renamed.');
    _render();
  });

  // Enter key in rename input
  document.getElementById('vault-rename-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('vault-rename-confirm')?.click(); }
  });

  // New section confirm
  document.getElementById('vault-new-section-confirm')?.addEventListener('click', async () => {
    const name = document.getElementById('vns-name')?.value?.trim();
    const type = document.getElementById('vns-type')?.value ?? 'custom';
    if (!name) { _showToast('Section name is required.'); return; }
    const sectionId = _uuid();
    _sectionOrder.push(sectionId);
    // For note/custom create an empty content row so the section is discoverable without _meta
    if (type === 'note' || type === 'custom') {
      _rows.push({ id: _uuid(), sectionId, sectionName: name, sectionType: type, fieldKey: 'content', fieldValue: '', extra: '', createdAt: _now(), updatedAt: _now() });
    }
    // For credential/todo/list/reminder: section is created with no rows — shows empty state + add button
    await _save();
    bootstrap.Modal.getInstance(document.getElementById('vault-new-section-modal'))?.hide();
    _render();
  });

  // Credential save
  document.getElementById('vault-cred-save')?.addEventListener('click', async () => {
    const modal = document.getElementById('vault-cred-modal');
    const sectionId = modal.dataset.sectionId;
    const entryId   = modal.dataset.entryId || _uuid();
    const sec = _getSections().find(s => s.id === sectionId);
    const pwdRaw = modal.querySelector('#vcm-password').value;
    const isNewPwd = !modal.dataset.entryId || pwdRaw !== deobfuscate(
      _rows.find(r => r.sectionId === sectionId && r.extra === modal.dataset.entryId && r.fieldKey === 'password')?.fieldValue ?? ''
    );
    const fields = {
      platform:    modal.querySelector('#vcm-platform').value.trim(),
      username:    modal.querySelector('#vcm-username').value.trim(),
      password:    obfuscate(pwdRaw),
      url:         modal.querySelector('#vcm-url').value.trim(),
      notes:       modal.querySelector('#vcm-notes').value.trim(),
      lastChanged: isNewPwd ? new Date().toISOString().slice(0, 10) : (modal.querySelector('#vcm-last-changed').value || ''),
    };
    if (!fields.platform) { _showToast('Platform name is required.'); return; }
    _rows = _rows.filter(r => !(r.sectionId === sectionId && r.extra === entryId));
    if (!_sectionOrder.includes(sectionId)) _sectionOrder.push(sectionId);
    for (const [key, val] of Object.entries(fields)) {
      _rows.push({ id: _uuid(), sectionId, sectionName: sec?.name ?? '', sectionType: 'credential', fieldKey: key, fieldValue: val, extra: entryId, createdAt: _now(), updatedAt: _now() });
    }
    await _save();
    bootstrap.Modal.getInstance(modal)?.hide();
    _render();
  });

  // Password eye toggle in modal
  document.getElementById('vcm-pwd-eye')?.addEventListener('click', () => {
    const inp  = document.getElementById('vcm-password');
    const icon = document.querySelector('#vcm-pwd-eye i');
    inp.type = inp.type === 'password' ? 'text' : 'password';
    icon.className = inp.type === 'password' ? 'bi bi-eye-fill' : 'bi bi-eye-slash-fill';
  });

  // Password strength indicator in modal
  document.getElementById('vcm-password')?.addEventListener('input', e => {
    const bar = document.getElementById('vcm-strength-bar');
    const lbl = document.getElementById('vcm-strength-label');
    const s = _pwdStrength(e.target.value);
    if (bar) { bar.style.width = `${(s.score / 5) * 100}%`; bar.style.background = s.color; }
    if (lbl) { lbl.textContent = s.label; lbl.style.color = s.color; }
  });
}
