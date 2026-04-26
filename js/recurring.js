// js/recurring.js — Recurring Transactions module

import { CONFIG } from './config.js';
import { appendRow, fetchRows, writeAllRows } from './api.js';
import * as store from './store.js';
import { formatCurrency, formatDate, bindDependentPaymentSelect } from './utils.js';
import { epConfirm } from './confirm.js';

// ─── Serialization ────────────────────────────────────────────────────────────
// Columns: id, type, category, amount, description, paymentMethod, frequency, day, startDate, lastCreated, paused

export function serialize(r) {
  return [r.id, r.type, r.category, String(r.amount), r.description, r.paymentMethod ?? '', r.frequency, String(r.day), r.startDate, r.lastCreated ?? '', r.paused ? 'true' : 'false'];
}

export function deserialize(row) {
  return {
    id:          row[0] ?? '',
    type:        row[1] ?? 'expense',
    category:    row[2] ?? '',
    amount:      parseFloat(row[3]) || 0,
    description: row[4] ?? '',
    paymentMethod: row[5] ?? '',
    frequency:   row[6] ?? 'monthly',
    day:         parseInt(row[7]) || 1,
    startDate:   row[8] ?? '',
    lastCreated: row[9] ?? '',
    paused:      row[10] === 'true',
  };
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Next due date calculation ────────────────────────────────────────────────

function _nextDueDate(rec) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(rec.startDate);

  if (rec.frequency === 'weekly') {
    // Next occurrence of the weekday matching startDate
    const dayOfWeek = start.getDay();
    const d = new Date(today);
    const diff = (dayOfWeek - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + (diff === 0 ? 0 : diff));
    return d;
  }

  if (rec.frequency === 'yearly') {
    const d = new Date(today.getFullYear(), start.getMonth(), rec.day);
    if (d < today) d.setFullYear(d.getFullYear() + 1);
    return d;
  }

  // monthly
  const d = new Date(today.getFullYear(), today.getMonth(), rec.day);
  if (d < today) d.setMonth(d.getMonth() + 1);
  return d;
}

// Returns the date string the entry should be created with, or null if nothing to do.
function _getCreateDate(rec) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);

  if (rec.startDate > todayStr) return null;

  let lastDue;

  if (rec.frequency === 'weekly') {
    const start = new Date(rec.startDate);
    const targetDay = start.getDay();
    const d = new Date(today);
    const diff = (d.getDay() - targetDay + 7) % 7;
    d.setDate(d.getDate() - diff);
    lastDue = d;
  } else if (rec.frequency === 'yearly') {
    const start = new Date(rec.startDate);
    const d = new Date(today.getFullYear(), start.getMonth(), rec.day);
    if (d > today) d.setFullYear(d.getFullYear() - 1);
    lastDue = d;
  } else {
    // monthly
    const yr = today.getFullYear(), mo = today.getMonth();
    if (today.getDate() >= rec.day) {
      lastDue = new Date(yr, mo, Math.min(rec.day, new Date(yr, mo + 1, 0).getDate()));
    } else {
      const pm = mo === 0 ? 11 : mo - 1;
      const py = mo === 0 ? yr - 1 : yr;
      lastDue = new Date(py, pm, Math.min(rec.day, new Date(py, pm + 1, 0).getDate()));
    }
  }

  const lastDueStr = lastDue.toISOString().slice(0, 10);
  if (rec.startDate > lastDueStr) return null;
  if (rec.lastCreated >= lastDueStr) return null;
  return lastDueStr;
}

// ─── Auto-create due entries ──────────────────────────────────────────────────

export async function processDueRecurring() {
  const todayStr = new Date().toISOString().slice(0, 10);
  let current = store.get('recurring') ?? [];

  for (const rec of current.filter(t => !t.paused)) {
    const createDate = _getCreateDate(rec);
    if (!createDate) continue;

    try {
      if (rec.type === 'expense') {
        const { serialize: serExp, deserialize: deExp } = await import('./expenses.js');
        const record = { date: createDate, category: rec.category, subCategory: '', amount: rec.amount, description: rec.description, paymentMethod: rec.paymentMethod };
        await appendRow(CONFIG.sheets.expenses, serExp(record));
        const rows = await fetchRows(CONFIG.sheets.expenses);
        store.set('expenses', rows.map(deExp));
      } else {
        const { serialize: serInc, deserialize: deInc } = await import('./income.js');
        const record = { date: createDate, source: rec.category, amount: rec.amount, description: rec.description, receivedIn: rec.paymentMethod };
        await appendRow(CONFIG.sheets.income, serInc(record));
        const rows = await fetchRows(CONFIG.sheets.income);
        store.set('income', rows.map(deInc));
      }

      current = current.map(t => t.id === rec.id ? { ...t, lastCreated: todayStr } : t);
      await writeAllRows(CONFIG.sheets.recurring, current.map(serialize));
      store.set('recurring', current);

      const label = createDate === todayStr ? 'today' : `backdated to ${createDate}`;
      console.info(`[recurring] Created ${rec.type}: ${rec.description} ${label} (${formatCurrency(rec.amount)})`);
    } catch (err) {
      console.warn('[recurring] Failed to create entry:', err);
    }
  }
}

// ─── Filter state & helpers ─────────────────────────────────────────────────

const filterState = { type: '', frequency: '', status: '', search: '', dateFrom: '', dateTo: '' };

function _pmIconRec(name) {
  if (!name) return 'bi-bank2';
  const n = name.toLowerCase();
  if (n.includes('cash')) return 'bi-cash-coin';
  if (n.includes('wallet') || n.includes('gpay') || n.includes('paytm') || n.includes('phonepe') || n.includes('upi')) return 'bi-wallet2';
  if (n.includes('card') || n.includes('credit')) return 'bi-credit-card-2-front';
  return 'bi-bank2';
}

function _freqLabel(r) {
  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  if (r.frequency === 'weekly') { const s = new Date(r.startDate); return `Every ${DAYS[s.getDay()]}`; }
  if (r.frequency === 'yearly') { const s = new Date(r.startDate); return `Yearly · ${s.toLocaleString('en-IN',{month:'short'})} ${r.day}`; }
  const sfx = r.day === 1 ? 'st' : r.day === 2 ? 'nd' : r.day === 3 ? 'rd' : 'th';
  return `Monthly on ${r.day}${sfx}`;
}

function applyRecFilters(templates) {
  const q = filterState.search.toLowerCase().trim();
  const today = new Date(); today.setHours(0,0,0,0);
  return templates.filter(r => {
    if (filterState.type && r.type !== filterState.type) return false;
    if (filterState.frequency && r.frequency !== filterState.frequency) return false;
    if (filterState.status === 'active' && r.paused) return false;
    if (filterState.status === 'paused' && !r.paused) return false;
    if (q && !r.description.toLowerCase().includes(q) && !r.category.toLowerCase().includes(q)) return false;
    if (filterState.dateFrom) {
      const from = new Date(filterState.dateFrom);
      if (isNaN(from)) return false;
      const next = _nextDueDate(r);
      if (next < from) return false;
    }
    if (filterState.dateTo) {
      const to = new Date(filterState.dateTo);
      if (isNaN(to)) return false;
      to.setHours(23,59,59,999);
      const next = _nextDueDate(r);
      if (next > to) return false;
    }
    return true;
  });
}

async function skipNext(id) {
  const templates = store.get('recurring') ?? [];
  const rec = templates.find(r => r.id === id);
  if (!rec) return;
  const today = new Date(); today.setHours(0,0,0,0);
  const next = _nextDueDate(rec);
  if (next <= today) {
    alert('Cannot skip today\'s due transaction. Pause instead.');
    return;
  }
  const updated = templates.map(r => r.id === id ? { ...r, lastCreated: next.toISOString().split('T')[0] } : r);
  try {
    await writeAllRows(CONFIG.sheets.recurring, updated.map(serialize));
    store.set('recurring', updated);
    render();
  } catch (err) {
    alert(err.message ?? 'Failed to skip next occurrence.');
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────

export function render() {
  const all = store.get('recurring') ?? [];
  const visible = applyRecFilters(all);
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // Sort: active soonest-due first, paused last
  visible.sort((a, b) => {
    if (a.paused !== b.paused) return a.paused ? 1 : -1;
    return _nextDueDate(a) - _nextDueDate(b);
  });

  // Stat cards (always computed from full set)
  const active = all.filter(r => !r.paused);
  const monthlyExp = active.filter(r => r.type === 'expense' && r.frequency === 'monthly').reduce((s, r) => s + r.amount, 0);
  const monthlyInc = active.filter(r => r.type === 'income'  && r.frequency === 'monthly').reduce((s, r) => s + r.amount, 0);
  const netMonthly = monthlyInc - monthlyExp;
  const _s = id => document.getElementById(id);
  if (_s('rec-stat-net')) _s('rec-stat-net').textContent = formatCurrency(Math.abs(netMonthly));
  if (_s('rec-stat-expenses')) _s('rec-stat-expenses').textContent = formatCurrency(monthlyExp);
  if (_s('rec-stat-income')) _s('rec-stat-income').textContent = formatCurrency(monthlyInc);

  // Hero subtitle
  const dueToday = active.filter(r => Math.round((_nextDueDate(r) - today) / 86400000) === 0).length;
  const heroSub = _s('rec-hero-sub');
  if (heroSub) heroSub.innerHTML = dueToday > 0
    ? `<strong>${dueToday} due today</strong> &middot; ${active.length} active template${active.length !== 1 ? 's' : ''}`
    : `${active.length} active template${active.length !== 1 ? 's' : ''} &middot; auto-creating on schedule`;

  const countEl = _s('recurring-count');
  if (countEl) countEl.textContent = visible.length > 0 ? String(visible.length) : '';

  const list = _s('recurring-list');
  const empty = _s('recurring-empty-state');
  if (!list) return;

  if (visible.length === 0) {
    list.innerHTML = '';
    if (empty) empty.classList.remove('d-none');
    return;
  }
  if (empty) empty.classList.add('d-none');

  list.innerHTML = `<div class="data-cards-grid">${visible.map(r => {
    const isExpense = r.type === 'expense';
    const next = _nextDueDate(r);
    const nextStr = next.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
    const daysUntil = Math.round((next - today) / 86400000);
    const urgencyCls = r.paused ? '' : daysUntil === 0 ? 'rec-urgency--today' : daysUntil <= 3 ? 'rec-urgency--soon' : '';
    const iconGrad = isExpense
      ? 'background:linear-gradient(135deg,#ef4444,#dc2626);box-shadow:0 4px 12px rgba(239,68,68,.3)'
      : 'background:linear-gradient(135deg,#10b981,#059669);box-shadow:0 4px 12px rgba(16,185,129,.3)';
    const dueBadge = !r.paused && daysUntil === 0 ? '<span class="rec-due-today-badge">DUE TODAY</span>'
      : !r.paused && daysUntil > 0 && daysUntil <= 3 ? `<span class="rec-due-soon-badge">In ${daysUntil}d</span>` : '';

    return `
      <div class="ecard ${isExpense ? 'ecard--expense' : 'ecard--income'}${r.paused ? ' rec-card--paused' : ''}">
        <div class="ecard-top">
          <div class="ecard-icon" style="${iconGrad}"><i class="bi bi-arrow-repeat"></i></div>
          <div class="ecard-body">
            <div class="ecard-desc">${escapeHtml(r.description)}${dueBadge}</div>
            <div class="ecard-badges">
              <span class="ecard-badge ${isExpense ? 'ecard-badge--expense' : 'ecard-badge--income'}">${escapeHtml(r.category)}</span>
              <span class="ecard-badge ecard-badge--sub">${_freqLabel(r)}</span>
              ${r.paused ? '<span class="ecard-badge rec-badge--paused"><i class="bi bi-pause-fill me-1"></i>Paused</span>' : ''}
            </div>
          </div>
          <div class="ecard-amount ${isExpense ? 'ecard-amount--expense' : 'ecard-amount--income'}">${formatCurrency(r.amount)}</div>
        </div>
        <div class="ecard-footer">
          <span class="ecard-chip ${urgencyCls}"><i class="bi bi-calendar3 me-1"></i>${r.paused ? 'Paused' : `Next: ${nextStr}`}</span>
          ${r.paymentMethod ? `<span class="ecard-chip"><i class="bi ${_pmIconRec(r.paymentMethod)} me-1"></i>${escapeHtml(r.paymentMethod)}</span>` : ''}
          <div class="ecard-actions">
            <button class="ecard-btn" data-skip-next-rec="${escapeHtml(r.id)}" title="Skip Next"><i class="bi bi-skip-forward-fill"></i></button>
            <button class="ecard-btn" data-toggle-pause-rec="${escapeHtml(r.id)}" title="${r.paused ? 'Resume' : 'Pause'}" style="color:${r.paused ? '#10b981' : '#f59e0b'}"><i class="bi ${r.paused ? 'bi-play-fill' : 'bi-pause-fill'}"></i></button>
            <button class="ecard-btn ecard-btn--edit" data-edit-rec="${escapeHtml(r.id)}" title="Edit"><i class="bi bi-pencil-fill"></i></button>
            <button class="ecard-btn ecard-btn--del" data-delete-rec="${escapeHtml(r.id)}" title="Delete"><i class="bi bi-trash-fill"></i></button>
          </div>
        </div>
      </div>`;
  }).join('')}</div>`;

  list.querySelectorAll('[data-skip-next-rec]').forEach(btn =>
    btn.addEventListener('click', () => skipNext(btn.dataset.skipNextRec)));
  list.querySelectorAll('[data-toggle-pause-rec]').forEach(btn =>
    btn.addEventListener('click', () => _togglePause(btn.dataset.togglePauseRec)));
  list.querySelectorAll('[data-edit-rec]').forEach(btn =>
    btn.addEventListener('click', () => _startEdit(btn.dataset.editRec)));
  list.querySelectorAll('[data-delete-rec]').forEach(btn =>
    btn.addEventListener('click', () => _deleteTemplate(btn.dataset.deleteRec)));
}

// ─── Form binding ─────────────────────────────────────────────────────────────

let _editingId = null;

function _startEdit(id) {
  const rec = (store.get('recurring') ?? []).find(r => r.id === id);
  if (!rec) return;
  _editingId = id;

  document.getElementById('rec-type').value = rec.type;
  _refreshCategoryDropdown();
  setTimeout(() => { document.getElementById('rec-category').value = rec.category; }, 0);
  document.getElementById('rec-amount').value = rec.amount;
  document.getElementById('rec-description').value = rec.description;
  document.getElementById('rec-frequency').value = rec.frequency;
  document.getElementById('rec-frequency')?.dispatchEvent(new Event('change'));
  if (rec.frequency === 'weekly') {
    setTimeout(() => { document.getElementById('rec-weekday').value = String(new Date(rec.startDate).getDay()); }, 0);
  }
  document.getElementById('rec-day').value = rec.day;
  document.getElementById('rec-start-date').value = rec.startDate;

  // Restore payment method
  const accounts = store.get('accounts') ?? [];
  const creditCards = store.get('creditCards') ?? [];
  const typeSel = document.getElementById('rec-payment-type');
  const valSel = document.getElementById('rec-payment-method');
  if (typeSel && valSel && rec.paymentMethod) {
    const isWallet = accounts.some(a => a.name === rec.paymentMethod && a.type === 'Wallet');
    const isCash   = accounts.some(a => a.name === rec.paymentMethod && a.type === 'Cash');
    const isAcc    = accounts.some(a => a.name === rec.paymentMethod && !['Wallet','Cash'].includes(a.type));
    typeSel.value = isWallet ? 'wallet' : isCash ? 'cash' : isAcc ? 'account' : 'card';
    typeSel.dispatchEvent(new Event('change'));
    setTimeout(() => { valSel.value = rec.paymentMethod; }, 0);
  }

  const cancelBtn = document.getElementById('rec-cancel-edit');
  if (cancelBtn) cancelBtn.classList.remove('d-none');
  const submitBtn = document.querySelector('#recurring-form [type="submit"]');
  if (submitBtn) submitBtn.textContent = 'Update Recurring';

  bootstrap.Modal.getOrCreateInstance(document.getElementById('oc-recurring')).show();
}

async function _togglePause(id) {
  const templates = store.get('recurring') ?? [];
  const updated = templates.map(r => r.id === id ? { ...r, paused: !r.paused } : r);
  try {
    await writeAllRows(CONFIG.sheets.recurring, updated.map(serialize));
    store.set('recurring', updated);
  } catch (err) {
    alert(err.message ?? 'Failed to toggle pause.');
  }
}

async function _deleteTemplate(id) {
  if (!await epConfirm('Delete this recurring template?', 'Delete Recurring', 'Delete')) return;
  const allTemplates = store.get('recurring') ?? [];
  const deleted = allTemplates.find(r => r.id === id);
  const templates = allTemplates.filter(r => r.id !== id);
  try {
    await writeAllRows(CONFIG.sheets.recurring, templates.map(serialize));
    store.set('recurring', templates);
    const { showUndoToast } = await import('./undo.js');
    showUndoToast('Recurring template deleted', async () => {
      const current = [...(store.get('recurring') ?? []), deleted];
      await writeAllRows(CONFIG.sheets.recurring, current.map(serialize));
      store.set('recurring', current);
    });
  } catch (err) {
    alert(err.message ?? 'Failed to delete.');
  }
}

function _refreshCategoryDropdown() {
  const type = document.getElementById('rec-type')?.value ?? 'expense';
  const sel = document.getElementById('rec-category');
  if (!sel) return;
  const cur = sel.value;
  let items = [];
  if (type === 'expense') {
    items = (store.get('expenseCategories') ?? []).map(c => c.name ?? c).sort((a, b) => a.localeCompare(b));
  } else {
    items = (store.get('incomeSources') ?? []).map(s => s.name ?? s).sort((a, b) => a.localeCompare(b));
  }
  sel.innerHTML = '<option value="">Select…</option>' +
    items.map(i => `<option value="${escapeHtml(i)}">${escapeHtml(i)}</option>`).join('');
  if (cur) sel.value = cur;
}

function _bindRecFilters() {
  const searchEl = document.getElementById('rec-search');
  const typeBtn = document.getElementById('rec-type-btn');
  const typeMenu = document.getElementById('rec-type-menu');
  const freqBtn = document.getElementById('rec-freq-btn');
  const freqMenu = document.getElementById('rec-freq-menu');
  const statusBtn = document.getElementById('rec-status-btn');
  const statusMenu = document.getElementById('rec-status-menu');
  const dateFrom = document.getElementById('rec-date-from');
  const dateTo = document.getElementById('rec-date-to');
  const clearBtn = document.getElementById('rec-clear-filters');
  const presetBtns = [...document.querySelectorAll('[data-rec-preset]')];

  // Search debounce
  let _st;
  searchEl?.addEventListener('input', () => {
    clearTimeout(_st);
    _st = setTimeout(() => { filterState.search = searchEl.value.trim(); render(); }, 220);
  });

  // Type dropdown
  typeBtn?.addEventListener('click', () => {
    const isOpen = typeMenu.classList.contains('fdd-open');
    typeMenu.classList.toggle('fdd-open');
    typeBtn.classList.toggle('fdd-btn--active', !isOpen);
    if (!isOpen) {
      typeMenu.innerHTML = ['All', 'Expense', 'Income'].map(v => 
        `<button class="fdd-item ${filterState.type === (v === 'All' ? '' : v.toLowerCase()) ? 'fdd-item--active' : ''}" data-value="${v === 'All' ? '' : v.toLowerCase()}">${v}</button>`
      ).join('');
      typeMenu.querySelectorAll('.fdd-item').forEach(item => 
        item.addEventListener('click', () => {
          filterState.type = item.dataset.value;
          typeMenu.classList.remove('fdd-open');
          typeBtn.classList.remove('fdd-btn--active');
          typeBtn.innerHTML = `<i class="bi bi-tag me-1"></i>Type <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
          if (filterState.type) typeBtn.innerHTML = `<i class="bi bi-tag me-1"></i>Type: ${filterState.type.charAt(0).toUpperCase() + filterState.type.slice(1)} <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
          render();
        })
      );
    }
  });

  // Frequency dropdown
  freqBtn?.addEventListener('click', () => {
    const isOpen = freqMenu.classList.contains('fdd-open');
    freqMenu.classList.toggle('fdd-open');
    freqBtn.classList.toggle('fdd-btn--active', !isOpen);
    if (!isOpen) {
      freqMenu.innerHTML = ['All', 'Monthly', 'Weekly', 'Yearly'].map(v => 
        `<button class="fdd-item ${filterState.frequency === (v === 'All' ? '' : v.toLowerCase()) ? 'fdd-item--active' : ''}" data-value="${v === 'All' ? '' : v.toLowerCase()}">${v}</button>`
      ).join('');
      freqMenu.querySelectorAll('.fdd-item').forEach(item => 
        item.addEventListener('click', () => {
          filterState.frequency = item.dataset.value;
          freqMenu.classList.remove('fdd-open');
          freqBtn.classList.remove('fdd-btn--active');
          freqBtn.innerHTML = `<i class="bi bi-calendar3 me-1"></i>Frequency <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
          if (filterState.frequency) freqBtn.innerHTML = `<i class="bi bi-calendar3 me-1"></i>Frequency: ${filterState.frequency.charAt(0).toUpperCase() + filterState.frequency.slice(1)} <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
          render();
        })
      );
    }
  });

  // Status dropdown
  statusBtn?.addEventListener('click', () => {
    const isOpen = statusMenu.classList.contains('fdd-open');
    statusMenu.classList.toggle('fdd-open');
    statusBtn.classList.toggle('fdd-btn--active', !isOpen);
    if (!isOpen) {
      statusMenu.innerHTML = ['All', 'Active', 'Paused'].map(v => 
        `<button class="fdd-item ${filterState.status === (v === 'All' ? '' : v.toLowerCase()) ? 'fdd-item--active' : ''}" data-value="${v === 'All' ? '' : v.toLowerCase()}">${v}</button>`
      ).join('');
      statusMenu.querySelectorAll('.fdd-item').forEach(item => 
        item.addEventListener('click', () => {
          filterState.status = item.dataset.value;
          statusMenu.classList.remove('fdd-open');
          statusBtn.classList.remove('fdd-btn--active');
          statusBtn.innerHTML = `<i class="bi bi-toggle-on me-1"></i>Status <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
          if (filterState.status) statusBtn.innerHTML = `<i class="bi bi-toggle-on me-1"></i>Status: ${filterState.status.charAt(0).toUpperCase() + filterState.status.slice(1)} <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
          render();
        })
      );
    }
  });

  // Date range
  dateFrom?.addEventListener('change', () => { filterState.dateFrom = dateFrom.value; render(); });
  dateTo?.addEventListener('change', () => { filterState.dateTo = dateTo.value; render(); });

  // Clear all
  clearBtn?.addEventListener('click', () => {
    filterState.type = ''; filterState.frequency = ''; filterState.status = ''; filterState.search = ''; filterState.dateFrom = ''; filterState.dateTo = '';
    if (searchEl) searchEl.value = '';
    if (dateFrom) dateFrom.value = '';
    if (dateTo) dateTo.value = '';
    typeBtn.innerHTML = `<i class="bi bi-tag me-1"></i>Type <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
    freqBtn.innerHTML = `<i class="bi bi-calendar3 me-1"></i>Frequency <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
    statusBtn.innerHTML = `<i class="bi bi-toggle-on me-1"></i>Status <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
    render();
  });

  // Quick presets
  presetBtns.forEach(btn => btn.addEventListener('click', () => {
    const preset = btn.dataset.recPreset;
    const today = new Date(); today.setHours(0,0,0,0);
    if (preset === 'all') {
      filterState.status = '';
    } else if (preset === 'due-soon') {
      filterState.status = 'active';
      filterState.dateFrom = today.toISOString().split('T')[0];
      const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);
      filterState.dateTo = weekEnd.toISOString().split('T')[0];
    } else if (preset === 'active') {
      filterState.status = 'active';
    } else if (preset === 'paused') {
      filterState.status = 'paused';
    }
    if (dateFrom) dateFrom.value = filterState.dateFrom || '';
    if (dateTo) dateTo.value = filterState.dateTo || '';
    statusBtn.innerHTML = `<i class="bi bi-toggle-on me-1"></i>Status <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
    if (filterState.status) statusBtn.innerHTML = `<i class="bi bi-toggle-on me-1"></i>Status: ${filterState.status.charAt(0).toUpperCase() + filterState.status.slice(1)} <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
    render();
  }));

  // Calculate next button
  document.getElementById('rec-calc-next')?.addEventListener('click', _updatePreview);

  // Live preview on form change
  ['rec-amount', 'rec-description', 'rec-frequency', 'rec-day', 'rec-weekday', 'rec-start-date'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', _updatePreview);
    document.getElementById(id)?.addEventListener('change', _updatePreview);
  });
}

export function init() {
  const form = document.getElementById('recurring-form');
  if (!form) return;

  // Type change → refresh category dropdown
  document.getElementById('rec-type')?.addEventListener('change', _refreshCategoryDropdown);
  _refreshCategoryDropdown();
  store.on('expenseCategories', _refreshCategoryDropdown);
  store.on('incomeSources', _refreshCategoryDropdown);

  // Frequency-aware day / weekday field toggle
  const _freqEl = document.getElementById('rec-frequency');
  const _dayW   = document.getElementById('rec-day-wrap');
  const _wkW    = document.getElementById('rec-weekday-wrap');
  _freqEl?.addEventListener('change', () => {
    const isWeekly = _freqEl.value === 'weekly';
    _dayW?.classList.toggle('d-none', isWeekly);
    _wkW?.classList.toggle('d-none', !isWeekly);
  });

  // Payment method dependent dropdowns
  const refreshPayment = bindDependentPaymentSelect('rec-payment-type', 'rec-payment-method', store);
  store.on('accounts', refreshPayment);
  store.on('creditCards', refreshPayment);

  // Cancel edit
  document.getElementById('rec-cancel-edit')?.addEventListener('click', () => {
    _editingId = null;
    form.reset();
    _refreshCategoryDropdown();
    document.getElementById('rec-cancel-edit')?.classList.add('d-none');
    const submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) submitBtn.textContent = 'Save Recurring';
  });

  // Reset on modal close
  document.getElementById('oc-recurring')?.addEventListener('hidden.bs.modal', () => {
    _editingId = null;
    form.reset();
    _refreshCategoryDropdown();
    document.getElementById('rec-cancel-edit')?.classList.add('d-none');
    const submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) submitBtn.textContent = 'Save Recurring';
    document.getElementById('recurring-form-error')?.classList.add('d-none');
    document.getElementById('rec-day-wrap')?.classList.remove('d-none');
    document.getElementById('rec-weekday-wrap')?.classList.add('d-none');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('recurring-form-error');
    const showErr = msg => { if (errEl) { errEl.textContent = msg; errEl.classList.remove('d-none'); } };
    if (errEl) errEl.classList.add('d-none');

    const type          = document.getElementById('rec-type')?.value ?? 'expense';
    const category      = document.getElementById('rec-category')?.value ?? '';
    const amount        = parseFloat(document.getElementById('rec-amount')?.value) || 0;
    const description   = document.getElementById('rec-description')?.value?.trim() ?? '';
    const paymentMethod = document.getElementById('rec-payment-method')?.value ?? '';
    const frequency     = document.getElementById('rec-frequency')?.value ?? 'monthly';
    const day           = frequency === 'weekly'
      ? parseInt(document.getElementById('rec-weekday')?.value ?? '1')
      : parseInt(document.getElementById('rec-day')?.value) || 1;
    const startDate     = document.getElementById('rec-start-date')?.value ?? '';

    if (!category) { showErr('Category / Source is required.'); return; }
    if (!amount || amount <= 0) { showErr('Amount must be positive.'); return; }
    if (!description) { showErr('Description is required.'); return; }
    if (!startDate) { showErr('Start date is required.'); return; }

    const record = { id: _editingId ?? crypto.randomUUID(), type, category, amount, description, paymentMethod, frequency, day, startDate, lastCreated: '', paused: false };

    try {
      let templates = store.get('recurring') ?? [];
      if (_editingId) {
        const existing = templates.find(r => r.id === _editingId);
        record.lastCreated = existing?.lastCreated ?? '';
        record.paused = existing?.paused ?? false;
        templates = templates.map(r => r.id === _editingId ? record : r);
      } else {
        templates = [...templates, record];
      }
      await writeAllRows(CONFIG.sheets.recurring, templates.map(serialize));
      store.set('recurring', templates);
      _editingId = null;
      form.reset();
      _refreshCategoryDropdown();
      bootstrap.Modal.getInstance(document.getElementById('oc-recurring'))?.hide();
    } catch (err) {
      showErr(err.message ?? 'Failed to save.');
    }
  });

  _bindRecFilters();
  store.on('recurring', render);
}

function _updatePreview() {
  const amount = parseFloat(document.getElementById('rec-amount')?.value) || 0;
  const desc = document.getElementById('rec-description')?.value?.trim() || '';
  const freq = document.getElementById('rec-frequency')?.value || 'monthly';
  const day = parseInt(document.getElementById('rec-day')?.value) || 1;
  const startDate = document.getElementById('rec-start-date')?.value || '';

  document.getElementById('rec-preview-amount').textContent = formatCurrency(amount);
  document.getElementById('rec-preview-desc').textContent = desc || '—';
  document.getElementById('rec-preview-freq').textContent = freq.charAt(0).toUpperCase() + freq.slice(1);

  if (startDate) {
    const mock = { frequency: freq, day, startDate };
    const next = _nextDueDate(mock);
    document.getElementById('rec-preview-next').textContent = next.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  } else {
    document.getElementById('rec-preview-next').textContent = '—';
  }
}
