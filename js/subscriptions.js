// js/subscriptions.js — Subscription Tracker module
import { CONFIG } from './config.js';
import { appendRow, fetchRows, writeAllRows } from './api.js';
import * as store from './store.js';
import { formatCurrency, bindDependentPaymentSelect, restorePaymentSelects } from './utils.js';
import { epConfirm } from './confirm.js';

// ─── Serialization ────────────────────────────────────────────────────────────
// Columns: id, name, category, amount, billingCycle, nextBillingDate, paymentMethod, notes, active, lastCreated

export function serialize(s) {
  return [s.id, s.name, s.category ?? '', String(s.amount), s.billingCycle ?? 'monthly', s.nextBillingDate ?? '', s.paymentMethod ?? '', s.notes ?? '', s.active !== false ? 'true' : 'false', s.lastCreated ?? ''];
}

export function deserialize(row) {
  return {
    id:              row[0] ?? '',
    name:            row[1] ?? '',
    category:        row[2] ?? '',
    amount:          parseFloat(row[3]) || 0,
    billingCycle:    row[4] ?? 'monthly',
    nextBillingDate: row[5] ?? '',
    paymentMethod:   row[6] ?? '',
    notes:           row[7] ?? '',
    active:          row[8] !== 'false',
    lastCreated:     row[9] ?? '',
  };
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Category icon map ────────────────────────────────────────────────────────────
const _SUB_ICONS = {
  netflix: 'bi-tv-fill', hotstar: 'bi-tv-fill', streaming: 'bi-tv-fill',
  prime: 'bi-tv-fill', disney: 'bi-tv-fill', hulu: 'bi-tv-fill',
  youtube: 'bi-youtube', ott: 'bi-tv-fill', video: 'bi-tv-fill',
  spotify: 'bi-music-note-beamed', music: 'bi-music-note-beamed',
  apple: 'bi-apple', icloud: 'bi-cloud-fill', cloud: 'bi-cloud-fill',
  drive: 'bi-cloud-fill', storage: 'bi-cloud-fill', dropbox: 'bi-cloud-fill',
  gaming: 'bi-controller', game: 'bi-controller', xbox: 'bi-controller',
  playstation: 'bi-controller', steam: 'bi-controller',
  office: 'bi-briefcase-fill', microsoft: 'bi-briefcase-fill',
  adobe: 'bi-palette-fill', productivity: 'bi-briefcase-fill',
  gym: 'bi-activity', fitness: 'bi-activity', health: 'bi-heart-pulse-fill',
  news: 'bi-newspaper', magazine: 'bi-newspaper', book: 'bi-book-fill',
  education: 'bi-book-fill', learning: 'bi-book-fill',
  security: 'bi-shield-fill-check', vpn: 'bi-shield-fill-check',
  antivirus: 'bi-shield-fill-check',
  chat: 'bi-chat-fill', communication: 'bi-chat-fill',
};

function _subIcon(name, category) {
  const key = ((name ?? '') + ' ' + (category ?? '')).toLowerCase().replace(/\s+/g, ' ');
  for (const [k, icon] of Object.entries(_SUB_ICONS)) {
    if (key.includes(k)) return icon;
  }
  return 'bi-collection-play-fill';
}

// ─── Filter state ─────────────────────────────────────────────────────────────
const _subFilter = { search: '', status: '' };

function _nextBillingLabel(dateStr) {
  if (!dateStr) return { label: '—', daysUntil: null };
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return { label: '—', daysUntil: null };
  const today = new Date(); today.setHours(0,0,0,0);
  const days = Math.round((d - today) / 86400000);
  const label = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  return { label, daysUntil: days };
}

function _annualCost(sub) {
  switch (sub.billingCycle) {
    case 'weekly':    return sub.amount * 52;
    case 'monthly':   return sub.amount * 12;
    case 'quarterly': return sub.amount * 4;
    case 'half-yearly': return sub.amount * 2;
    case 'yearly':    return sub.amount;
    default:          return sub.amount * 12;
  }
}

function _monthlyCost(sub) {
  return _annualCost(sub) / 12;
}

// ─── Render ────────────────────────────────────────────────────────────────

export function render() {
  const all    = store.get('subscriptions') ?? [];
  const active = all.filter(s => s.active !== false);

  // Stat cards
  const monthlyTotal = active.reduce((s, sub) => s + _monthlyCost(sub), 0);
  const annualTotal  = active.reduce((s, sub) => s + _annualCost(sub),  0);
  const today = new Date(); today.setHours(0,0,0,0);
  const in7   = new Date(today); in7.setDate(today.getDate() + 7);
  const dueThisWeek = active.filter(s => {
    if (!s.nextBillingDate) return false;
    const d = new Date(s.nextBillingDate + 'T00:00:00');
    return d >= today && d <= in7;
  }).length;

  const _s = id => document.getElementById(id);
  if (_s('sub-stat-count'))    _s('sub-stat-count').textContent    = active.length;
  if (_s('sub-stat-monthly'))  _s('sub-stat-monthly').textContent  = formatCurrency(Math.round(monthlyTotal));
  if (_s('sub-stat-annual'))   _s('sub-stat-annual').textContent   = formatCurrency(Math.round(annualTotal));
  if (_s('sub-stat-due-week')) _s('sub-stat-due-week').textContent = dueThisWeek;

  // Hero subtitle
  const heroSub = _s('sub-hero-sub');
  if (heroSub) {
    heroSub.innerHTML = active.length
      ? `${formatCurrency(Math.round(monthlyTotal))}/mo across <strong style="color:#e9d5ff">${active.length}</strong> active service${active.length !== 1 ? 's' : ''}`
      : 'Track recurring digital services';
  }

  const container = document.getElementById('subscriptions-list');
  const emptyEl   = document.getElementById('sub-empty-state');
  if (!container) return;

  // Apply filters
  const search = _subFilter.search.toLowerCase();
  const status = _subFilter.status;
  const filtered = all.filter(s => {
    if (search && !s.name.toLowerCase().includes(search) && !(s.category ?? '').toLowerCase().includes(search)) return false;
    if (!status || status === 'all') return true;
    const { daysUntil } = _nextBillingLabel(s.nextBillingDate);
    if (status === 'active')   return s.active !== false;
    if (status === 'inactive') return s.active === false;
    if (status === 'due-week') return s.active !== false && daysUntil !== null && daysUntil >= 0 && daysUntil <= 7;
    if (status === 'overdue')  return s.active !== false && daysUntil !== null && daysUntil < 0;
    return true;
  });

  const countBadge = _s('sub-count-badge');
  if (countBadge) countBadge.textContent = filtered.length || '';

  if (all.length === 0) {
    container.innerHTML = '';
    if (emptyEl) emptyEl.classList.remove('d-none');
    return;
  }
  if (emptyEl) emptyEl.classList.add('d-none');

  if (filtered.length === 0) {
    container.innerHTML = '<div class="text-center text-muted py-4 small">No subscriptions match the current filter.</div>';
    return;
  }

  const CYCLE_LABELS = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', 'half-yearly': 'Half-Yearly', yearly: 'Yearly' };
  const FREQ_SHORT   = { weekly: '/ wk', monthly: '/ mo', quarterly: '/ qtr', 'half-yearly': '/ 6mo', yearly: '/ yr' };

  container.innerHTML = `<div class="data-cards-grid">${filtered.map(sub => {
    const { label: dueLabel, daysUntil } = _nextBillingLabel(sub.nextBillingDate);
    const isInactive = sub.active === false;
    const isOverdue  = !isInactive && daysUntil !== null && daysUntil < 0;
    const isDueToday = !isInactive && daysUntil === 0;
    const isDueSoon  = !isInactive && daysUntil !== null && daysUntil <= 3;
    const isDueWeek  = !isInactive && daysUntil !== null && daysUntil <= 7;

    // Urgency colors
    const borderColor = isInactive ? '#e2e8f0'
      : isOverdue   ? '#ef4444'
      : isDueToday  ? '#f97316'
      : isDueSoon   ? '#f59e0b'
      : isDueWeek   ? '#0ea5e9'
      : '#e2e8f0';
    const chipColor = isInactive ? '#94a3b8'
      : isOverdue  ? '#dc2626'
      : isDueToday ? '#ea580c'
      : isDueSoon  ? '#d97706'
      : isDueWeek  ? '#0284c7'
      : '#64748b';
    const dueText = isOverdue  ? `Overdue by ${Math.abs(daysUntil)}d`
      : isDueToday ? 'Due today'
      : daysUntil === 1 ? 'Due tomorrow'
      : isDueWeek  ? `Due in ${daysUntil}d`
      : dueLabel;

    // Urgency bar (skip for inactive; green = safe default)
    const barPct   = isOverdue ? 100 : daysUntil === null ? 0 : Math.max(0, Math.round((1 - daysUntil / 30) * 100));
    const barColor = isOverdue ? '#ef4444' : isDueSoon ? '#f97316' : isDueWeek ? '#f59e0b' : '#34d399';

    // Icon + shadow by state
    const catIcon    = _subIcon(sub.name, sub.category);
    const iconBg     = isInactive ? 'linear-gradient(135deg,#94a3b8,#cbd5e1)'
      : isOverdue ? 'linear-gradient(135deg,#ef4444,#f87171)'
      : 'linear-gradient(135deg,#7c3aed,#8b5cf6)';
    const iconShadow = isInactive ? 'none'
      : isOverdue ? '0 4px 12px rgba(239,68,68,.25)'
      : '0 4px 12px rgba(124,58,237,.2)';

    // Freq
    const freqShort = FREQ_SHORT[sub.billingCycle] ?? '/ mo';
    const cycleLabel = CYCLE_LABELS[sub.billingCycle] ?? sub.billingCycle;

    // Pause/resume
    const toggleIcon  = isInactive ? 'bi-play-fill'  : 'bi-pause-fill';
    const toggleClass = isInactive ? 'bill-toggle-btn--resume' : 'bill-toggle-btn--pause';

    // Only show /mo chip for non-monthly cycles
    const moChip = sub.billingCycle !== 'monthly'
      ? `<span class="ecard-chip"><i class="bi bi-calculator me-1"></i>≈${formatCurrency(Math.round(_monthlyCost(sub)))}/mo</span>` : '';

    // Notes chip (truncated)
    const notesChip = sub.notes
      ? `<span class="ecard-chip sub-notes-chip"><i class="bi bi-chat-square-text me-1"></i>${escapeHtml(sub.notes.length > 30 ? sub.notes.slice(0, 30) + '…' : sub.notes)}</span>` : '';

    // Category fallback
    const catLabel = (sub.category ?? '').trim() || 'General';

    // Due chip: show 'Paused' for inactive, billing date for active
    const dueChipContent = isInactive
      ? `<i class="bi bi-pause-circle me-1"></i>Paused`
      : `<i class="bi ${isOverdue ? 'bi-exclamation-triangle-fill' : 'bi-calendar-event'} me-1"></i>${dueText}`;
    const dueChipStyle = isInactive
      ? `color:#64748b;border-color:#e2e8f020;background:#f1f5f9`
      : `color:${chipColor};border-color:${borderColor}25;background:${borderColor}10`;

    return `
      <div class="ecard ecard--subscription${isInactive ? ' sub-card--inactive' : ''}" style="border-left:3.5px solid ${borderColor}">
        <div class="ecard-top">
          <div class="ecard-icon" style="background:${iconBg};box-shadow:${iconShadow}"><i class="bi ${catIcon}"></i></div>
          <div class="ecard-body">
            <div class="ecard-desc">${escapeHtml(sub.name)}</div>
            <div class="ecard-badges">
              <span class="ecard-badge sub-badge--category">${escapeHtml(catLabel)}</span>
              <span class="ecard-badge ecard-badge--sub">${cycleLabel}</span>
            </div>
          </div>
          <div class="ecard-amount-block">
            <div class="ecard-amount ecard-amount--subscription">${formatCurrency(sub.amount)}</div>
            <div class="bill-freq-label">${freqShort}</div>
          </div>
        </div>
        ${!isInactive ? `<div class="bill-urgency-bar-wrap"><div class="bill-urgency-bar" style="width:${barPct}%;background:${barColor}"></div></div>` : ''}
        <div class="ecard-footer bill-footer">
          <div class="bill-footer-info">
            <span class="ecard-chip bill-due-chip" style="${dueChipStyle}">${dueChipContent}</span>
            ${sub.paymentMethod ? `<span class="ecard-chip"><i class="bi bi-credit-card me-1"></i>${escapeHtml(sub.paymentMethod)}</span>` : ''}
            ${moChip}
            ${notesChip}
          </div>
          <div class="bill-footer-actions">
            <button class="ecard-btn bill-toggle-btn ${toggleClass}" data-sub-toggle="${escapeHtml(sub.id)}" title="${isInactive ? 'Resume' : 'Pause'}"><i class="bi ${toggleIcon}"></i></button>
            <button class="ecard-btn ecard-btn--edit sub-edit-btn" data-id="${escapeHtml(sub.id)}" title="Edit"><i class="bi bi-pencil-fill"></i></button>
            <button class="ecard-btn ecard-btn--del bud-del-btn sub-del-btn" data-id="${escapeHtml(sub.id)}" title="Delete"><i class="bi bi-trash3-fill"></i></button>
          </div>
        </div>
      </div>`;
  }).join('')}</div>`;

  container.querySelectorAll('.sub-del-btn').forEach(btn =>
    btn.addEventListener('click', () => _handleDelete(btn.dataset.id)));
  container.querySelectorAll('.sub-edit-btn').forEach(btn =>
    btn.addEventListener('click', () => _openEdit(btn.dataset.id)));
  container.querySelectorAll('[data-sub-toggle]').forEach(btn =>
    btn.addEventListener('click', () => _toggleActive(btn.dataset.subToggle)));
}

// ─── Toggle Active ───────────────────────────────────────────────────────────

async function _toggleActive(id) {
  const records = store.get('subscriptions') ?? [];
  const updated = records.map(s => s.id === id ? { ...s, active: !s.active } : s);
  try {
    await writeAllRows(CONFIG.sheets.subscriptions, updated.map(serialize));
    store.set('subscriptions', updated);
  } catch (err) {
    alert(err.message ?? 'Failed to update.');
  }
}

// ─── Delete ───────────────────────────────────────────────────────────────────

async function _handleDelete(id) {
  const confirmed = await epConfirm('Delete this subscription?');
  if (!confirmed) return;
  const records = store.get('subscriptions') ?? [];
  const updated = records.filter(s => s.id !== id);
  try {
    await writeAllRows(CONFIG.sheets.subscriptions, updated.map(serialize));
    store.set('subscriptions', updated);
  } catch (err) {
    alert(err.message ?? 'Failed to delete.');
  }
}

// ─── Form ─────────────────────────────────────────────────────────────────────

function _openEdit(id) {
  const records = store.get('subscriptions') ?? [];
  const sub = records.find(s => s.id === id);
  if (!sub) return;
  _populateForm(sub);
  document.getElementById('sub-form-title').textContent = 'Edit Subscription';
  document.getElementById('sub-editing-id').value = id;
  document.getElementById('sub-cancel-edit').classList.remove('d-none');
  const modal = document.getElementById('oc-subscription');
  if (modal) bootstrap.Modal.getOrCreateInstance(modal).show();
}

function _populateForm(sub) {
  const f = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
  f('sub-name', sub.name);
  f('sub-category', sub.category);
  f('sub-amount', sub.amount);
  f('sub-cycle', sub.billingCycle);
  f('sub-next-date', sub.nextBillingDate);
  restorePaymentSelects('sub-payment-type', 'sub-payment-method', sub.paymentMethod, store);
  f('sub-notes', sub.notes);
  const activeEl = document.getElementById('sub-active');
  if (activeEl) activeEl.value = sub.active !== false ? 'true' : 'false';
}

function _resetForm() {
  const form = document.getElementById('sub-form');
  if (form) form.reset();
  const titleEl = document.getElementById('sub-form-title');
  if (titleEl) titleEl.textContent = 'Add Subscription';
  const idEl = document.getElementById('sub-editing-id');
  if (idEl) idEl.value = '';
  const cancelBtn = document.getElementById('sub-cancel-edit');
  if (cancelBtn) cancelBtn.classList.add('d-none');
  const modal = document.getElementById('oc-subscription');
  if (modal) bootstrap.Modal.getInstance(modal)?.hide();
}

// ─── Advance nextBillingDate by one cycle ─────────────────────────────────────

function _advanceDate(dateStr, cycle) {
  const d = new Date(dateStr + 'T00:00:00');
  switch (cycle) {
    case 'weekly':      d.setDate(d.getDate() + 7);      break;
    case 'monthly':     d.setMonth(d.getMonth() + 1);    break;
    case 'quarterly':   d.setMonth(d.getMonth() + 3);    break;
    case 'half-yearly': d.setMonth(d.getMonth() + 6);    break;
    case 'yearly':      d.setFullYear(d.getFullYear()+1); break;
    default:            d.setMonth(d.getMonth() + 1);
  }
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ─── Auto-create due expenses ─────────────────────────────────────────────────

export async function processDueSubscriptions() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  let subs = store.get('subscriptions') ?? [];
  const due = subs.filter(s =>
    s.active !== false &&
    s.nextBillingDate &&
    s.nextBillingDate <= todayStr &&
    s.lastCreated !== todayStr
  );

  if (due.length === 0) return;

  const { serialize: serExp, deserialize: deExp } = await import('./expenses.js');
  const { appendRow: _append, fetchRows: _fetch } = await import('./api.js');

  for (const sub of due) {
    try {
      const record = {
        date:          sub.nextBillingDate <= todayStr ? todayStr : sub.nextBillingDate,
        category:      sub.category || 'Subscriptions',
        subCategory:   '',
        amount:        sub.amount,
        description:   sub.name,
        paymentMethod: sub.paymentMethod ?? '',
      };
      await _append(CONFIG.sheets.expenses, serExp(record));
      const rows = await _fetch(CONFIG.sheets.expenses);
      store.set('expenses', rows.map(deExp));

      // Advance nextBillingDate and mark lastCreated
      subs = subs.map(s => s.id === sub.id
        ? { ...s, nextBillingDate: _advanceDate(sub.nextBillingDate, sub.billingCycle), lastCreated: todayStr }
        : s
      );
      await writeAllRows(CONFIG.sheets.subscriptions, subs.map(serialize));
      store.set('subscriptions', subs);

      console.info(`[subscriptions] Auto-created expense: ${sub.name} ₹${sub.amount} on ${todayStr}`);
    } catch (err) {
      console.warn('[subscriptions] Failed to create expense:', err);
    }
  }
}

// ─── Filter binding ───────────────────────────────────────────────────────────

function _bindSubFilters() {
  const searchEl = document.getElementById('sub-search');
  if (searchEl) {
    let _t;
    searchEl.addEventListener('input', () => {
      clearTimeout(_t);
      _t = setTimeout(() => { _subFilter.search = searchEl.value; render(); }, 220);
    });
  }

  const statusBtn  = document.getElementById('sub-status-btn');
  const statusMenu = document.getElementById('sub-status-menu');
  if (statusBtn && statusMenu) {
    const opts = [
      { val: '',         label: 'All' },
      { val: 'active',   label: '🟣 Active' },
      { val: 'inactive', label: '⚫ Paused / Inactive' },
      { val: 'due-week', label: '🟡 Due This Week' },
      { val: 'overdue',  label: '🔴 Overdue' },
    ];
    statusMenu.innerHTML = opts.map(o =>
      `<button class="fdd-item" data-val="${o.val}">${o.label}</button>`).join('');
    statusBtn.addEventListener('click', () => statusMenu.classList.toggle('fdd-open'));
    document.addEventListener('click', e => {
      if (!statusBtn.contains(e.target) && !statusMenu.contains(e.target))
        statusMenu.classList.remove('fdd-open');
    });
    statusMenu.querySelectorAll('.fdd-item').forEach(item => {
      item.addEventListener('click', () => {
        _subFilter.status = item.dataset.val;
        statusBtn.innerHTML = `<i class="bi bi-funnel me-1"></i>${item.textContent} <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
        statusMenu.classList.remove('fdd-open');
        render();
      });
    });
  }

  document.querySelectorAll('[data-sub-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      _subFilter.status = btn.dataset.subPreset;
      _subFilter.search = '';
      const el = document.getElementById('sub-search');
      if (el) el.value = '';
      const sb = document.getElementById('sub-status-btn');
      if (sb) sb.innerHTML = `<i class="bi bi-funnel me-1"></i>${btn.textContent} <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
      render();
    });
  });
}

export function init() {
  store.on('subscriptions', render);

  const form = document.getElementById('sub-form');
  if (!form) return;

  const refreshPayment = bindDependentPaymentSelect('sub-payment-type', 'sub-payment-method', store);
  store.on('accounts',    refreshPayment);
  store.on('creditCards', refreshPayment);

  _bindSubFilters();

  const cancelBtn = document.getElementById('sub-cancel-edit');
  if (cancelBtn) cancelBtn.addEventListener('click', _resetForm);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameEl = document.getElementById('sub-name');
    const amtEl  = document.getElementById('sub-amount');
    const name   = nameEl?.value?.trim() ?? '';
    const amount = parseFloat(amtEl?.value ?? '') || 0;

    if (!name) { nameEl?.classList.add('is-invalid'); return; }
    nameEl?.classList.remove('is-invalid');
    if (amount <= 0) { amtEl?.classList.add('is-invalid'); return; }
    amtEl?.classList.remove('is-invalid');

    const editingId = document.getElementById('sub-editing-id')?.value?.trim();
    const records   = store.get('subscriptions') ?? [];

    const sub = {
      id:              editingId || `sub_${Date.now()}`,
      name,
      category:        document.getElementById('sub-category')?.value?.trim() ?? '',
      amount,
      billingCycle:    document.getElementById('sub-cycle')?.value ?? 'monthly',
      nextBillingDate: document.getElementById('sub-next-date')?.value ?? '',
      paymentMethod:   document.getElementById('sub-payment-method')?.value?.trim() ?? '',
      notes:           document.getElementById('sub-notes')?.value?.trim() ?? '',
      active:          document.getElementById('sub-active')?.value !== 'false',
    };

    const updated = editingId
      ? records.map(s => s.id === editingId ? sub : s)
      : [...records, sub];

    try {
      await writeAllRows(CONFIG.sheets.subscriptions, updated.map(serialize));
      store.set('subscriptions', updated);
      _resetForm();
      const modal = document.getElementById('oc-subscription');
      if (modal) bootstrap.Modal.getInstance(modal)?.hide();
    } catch (err) {
      alert(err.message ?? 'Failed to save.');
    }
  });
}
