// js/trip-expenses.js — Trip Expense Tracker
// Manages trips, per-trip expenses, auto-sync to main expenses, and split lending.

import { CONFIG }                        from './config.js';
import { appendRow, fetchRows, writeAllRows } from './api.js';
import * as store                        from './store.js';
import { formatCurrency, formatDate, bindDependentPaymentSelect } from './utils.js';
import { serialize as serializeExpense } from './expenses.js';
import { epConfirm }                     from './confirm.js';

// ─── Serialization ────────────────────────────────────────────────────────────
// Trip columns: id|name|destination|startDate|endDate|participantsJSON|budget|status|note

export function serializeTrip(t) {
  return [
    t.id, t.name, t.destination ?? '', t.startDate, t.endDate ?? '',
    JSON.stringify(t.participants ?? []),
    String(t.budget ?? ''), t.status ?? 'active', t.note ?? '',
  ];
}

export function deserializeTrip(row) {
  let participants = [];
  try { participants = JSON.parse(row[5] ?? '[]'); } catch { /* ignore */ }
  return {
    id: row[0] ?? '', name: row[1] ?? '', destination: row[2] ?? '',
    startDate: row[3] ?? '', endDate: row[4] ?? '', participants,
    budget: parseFloat(row[6]) || 0, status: row[7] ?? 'active', note: row[8] ?? '',
  };
}

// TripExpense columns: id|tripId|date|category|subCategory|amount|description|
//                      paymentType|paymentMethod|paidBy|splitWithJSON|splitType|customSplitsJSON|linkedExpenseId

export function serializeTripExp(e) {
  return [
    e.id, e.tripId, e.date, e.category, e.subCategory ?? '',
    String(e.amount), e.description,
    e.paymentType ?? 'Cash', e.paymentMethod ?? '', e.paidBy ?? 'Me',
    JSON.stringify(e.splitWith ?? []), e.splitType ?? 'none',
    JSON.stringify(e.customSplits ?? {}), e.linkedExpenseId ?? '',
  ];
}

export function deserializeTripExp(row) {
  let splitWith = [], customSplits = {};
  try { splitWith    = JSON.parse(row[10] ?? '[]');  } catch { /* ignore */ }
  try { customSplits = JSON.parse(row[12] ?? '{}');  } catch { /* ignore */ }
  return {
    id: row[0] ?? '', tripId: row[1] ?? '', date: row[2] ?? '',
    category: row[3] ?? '', subCategory: row[4] ?? '',
    amount: parseFloat(row[5]) || 0, description: row[6] ?? '',
    paymentType: row[7] ?? 'Cash', paymentMethod: row[8] ?? '',
    paidBy: row[9] ?? 'Me', splitWith, splitType: row[11] ?? 'none',
    customSplits, linkedExpenseId: row[13] ?? '',
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmt(n) { return formatCurrency(Number(n) || 0); }

function _el(id) { return document.getElementById(id); }

function _showErr(id, msg) {
  const el = _el(id);
  if (el) { el.textContent = msg; el.classList.remove('d-none'); }
}

function _hideErr(id) {
  const el = _el(id);
  if (el) el.classList.add('d-none');
}

// ─── Active trip state ────────────────────────────────────────────────────────

let _activeTripId = null;

// ─── Filter state ─────────────────────────────────────────────────────────────

const _tripFilter = { search: '', status: '', sort: 'newest' };

// ─── Category icon / colour maps ──────────────────────────────────────────────

const CAT_COLORS = {
  Food:'#f59e0b', Dining:'#f59e0b', Transport:'#3b82f6', Travel:'#6366f1',
  Accommodation:'#8b5cf6', Hotel:'#8b5cf6', Shopping:'#ec4899',
  Entertainment:'#6366f1', Sightseeing:'#10b981', Fuel:'#f97316',
  Groceries:'#10b981', Medical:'#ef4444',
};

const CAT_ICONS_MAP = {
  Food:'bi-cup-hot-fill', Dining:'bi-cup-hot-fill', Transport:'bi-car-front-fill',
  Travel:'bi-airplane-fill', Accommodation:'bi-house-fill', Hotel:'bi-house-fill',
  Shopping:'bi-bag-fill', Entertainment:'bi-film', Sightseeing:'bi-binoculars-fill',
  Fuel:'bi-fuel-pump-fill', Groceries:'bi-basket-fill', Medical:'bi-heart-pulse-fill',
};

const AVATAR_COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#3b82f6','#8b5cf6','#f97316','#14b8a6'];

function _catIconHtml(category) {
  const icon  = CAT_ICONS_MAP[category] ?? 'bi-tag-fill';
  const color = CAT_COLORS[category]    ?? '#64748b';
  return `<span class="te-cat-icon" style="background:${color}18;color:${color}"><i class="bi ${icon}"></i></span>`;
}

function _avatarChip(name, idx) {
  const color   = AVATAR_COLORS[(idx ?? 0) % AVATAR_COLORS.length];
  const initial = (name || '?')[0].toUpperCase();
  return `<span class="te-avatar-chip" style="background:${color}" title="${esc(name)}">${initial}</span>`;
}

function _timeChip(trip) {
  if (trip.status === 'completed') return '';
  const today = new Date(); today.setHours(0,0,0,0);
  const start = trip.startDate ? new Date(trip.startDate + 'T00:00:00') : null;
  const end   = trip.endDate   ? new Date(trip.endDate   + 'T00:00:00') : null;
  if (!start) return '';
  const daysToStart = Math.round((start - today) / 86400000);
  if (daysToStart > 0)
    return `<span class="te-time-chip te-time-chip--blue"><i class="bi bi-clock me-1"></i>Starts in ${daysToStart}d</span>`;
  if (end && end >= today)
    return `<span class="te-time-chip te-time-chip--green"><i class="bi bi-broadcast me-1"></i>Ongoing</span>`;
  const daysAgo = Math.abs(end ? Math.round((today - end) / 86400000) : Math.round((today - start) / 86400000));
  if (daysAgo <= 30)
    return `<span class="te-time-chip te-time-chip--amber"><i class="bi bi-calendar-check me-1"></i>${daysAgo}d ago</span>`;
  return '';
}

function _topCategories(exps, n) {
  const totals = {};
  exps.forEach(e => { totals[e.category] = (totals[e.category] || 0) + e.amount; });
  return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function _dayNumber(tripStart, date) {
  if (!tripStart) return null;
  const diff = Math.round((new Date(date + 'T00:00:00') - new Date(tripStart + 'T00:00:00')) / 86400000);
  return diff >= 0 ? diff + 1 : null;
}

// ─── Rendering — Trips List ───────────────────────────────────────────────────

export function render() {
  _renderStats();
  _renderTripCards();
  if (_activeTripId) {
    _renderTripDetail(_activeTripId);
  }
}

function _renderStats() {
  const trips    = store.get('trips') ?? [];
  const tripExps = store.get('tripExpenses') ?? [];
  const active   = trips.filter(t => t.status === 'active').length;
  const total    = tripExps.reduce((s, e) => s + e.amount, 0);
  const avg      = trips.length > 0 ? total / trips.length : 0;

  const el = id => _el(id);
  if (el('te-stat-trips'))  el('te-stat-trips').textContent  = trips.length;
  if (el('te-stat-active')) el('te-stat-active').textContent = active;
  if (el('te-stat-total'))  el('te-stat-total').textContent  = fmt(total);
  if (el('te-stat-avg'))    el('te-stat-avg').textContent    = fmt(Math.round(avg));

  const heroSub = el('te-hero-sub');
  if (heroSub) {
    heroSub.innerHTML = trips.length
      ? `<strong style="color:#6ee7b7">${active}</strong> active trip${active !== 1 ? 's' : ''} &nbsp;·&nbsp; <strong style="color:#6ee7b7">${fmt(Math.round(total))}</strong> total spent`
      : 'Track trips, split costs with friends &amp; family';
  }
}

function _renderTripCards() {
  const container = _el('te-trips-list');
  const empty     = _el('te-trips-empty');
  if (!container) return;

  const tripExps = store.get('tripExpenses') ?? [];
  const allTrips = (store.get('trips') ?? []).sort((a, b) => {
    switch (_tripFilter.sort) {
      case 'oldest':    return a.startDate.localeCompare(b.startDate);
      case 'name':      return a.name.localeCompare(b.name);
      case 'most-spent': {
        const sa = tripExps.filter(e => e.tripId === a.id).reduce((s, e) => s + e.amount, 0);
        const sb = tripExps.filter(e => e.tripId === b.id).reduce((s, e) => s + e.amount, 0);
        return sb - sa;
      }
      default: return b.startDate.localeCompare(a.startDate);
    }
  });
  const search  = _tripFilter.search.toLowerCase();
  const statusF = _tripFilter.status;

  const trips = allTrips.filter(t =>
    (!search  || t.name.toLowerCase().includes(search) || (t.destination ?? '').toLowerCase().includes(search)) &&
    (!statusF || t.status === statusF)
  );

  const countEl = _el('te-trip-count');
  if (countEl) countEl.textContent = trips.length || '';

  if (!allTrips.length) {
    container.innerHTML = '';
    if (empty) {
      empty.classList.remove('d-none');
      empty.innerHTML = `<div class="ep-empty-state">
        <div class="ep-es-icon-wrap" style="background:linear-gradient(135deg,#10b981,#059669);box-shadow:0 8px 32px rgba(16,185,129,.3)"><i class="bi bi-airplane-fill"></i></div>
        <div class="ep-es-title">No trips yet</div>
        <div class="ep-es-subtitle">Plan your next adventure — create a trip to track expenses with friends or family.</div>
        <button class="btn btn-success ep-es-cta" data-bs-toggle="modal" data-bs-target="#oc-create-trip"><i class="bi bi-plus-circle-fill me-2"></i>Create Your First Trip</button>
      </div>`;
    }
    return;
  }
  empty?.classList.add('d-none');

  if (!trips.length) {
    container.innerHTML = `<div class="ep-empty-state">
      <div class="ep-es-icon-wrap" style="background:linear-gradient(135deg,#10b981,#059669);box-shadow:0 8px 32px rgba(16,185,129,.3)"><i class="bi bi-airplane-fill"></i></div>
      <div class="ep-es-title">No trips match your filters</div>
      <div class="ep-es-subtitle">Try clearing the filters to see all trips.</div>
    </div>`;
    return;
  }

  container.innerHTML = trips.map(t => {
    const exps     = tripExps.filter(e => e.tripId === t.id);
    const spent    = exps.reduce((s, e) => s + e.amount, 0);
    const pct      = t.budget > 0 ? Math.min((spent / t.budget) * 100, 100) : null;
    const barColor = pct === null ? '#10b981' : pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#10b981';
    const dateRange = t.endDate
      ? `${formatDate(t.startDate)} – ${formatDate(t.endDate)}`
      : `From ${formatDate(t.startDate)}`;
    const isDone = t.status === 'completed';
    const statusChip = isDone
      ? `<span class="te-status-chip te-status-chip--done"><i class="bi bi-check-circle-fill me-1"></i>Completed</span>`
      : `<span class="te-status-chip te-status-chip--active"><i class="bi bi-circle-fill me-1" style="font-size:.4rem"></i>Active</span>`;
    const timeC = _timeChip(t);
    const topCats = _topCategories(exps, 3);
    const catBar = spent > 0 && topCats.length > 1 ? `
      <div class="te-cat-bar">${topCats.map(([cat, amt]) => {
        const pctCat = (amt / spent * 100).toFixed(0);
        const c = CAT_COLORS[cat] ?? '#64748b';
        return `<div class="te-cat-seg" style="width:${pctCat}%;background:${c}" title="${esc(cat)}: ${fmt(amt)}"></div>`;
      }).join('')}</div>
      <div class="te-cat-labels">${topCats.map(([cat]) => {
        const c = CAT_COLORS[cat] ?? '#64748b';
        return `<span style="color:${c}"><i class="bi bi-circle-fill me-1" style="font-size:.35rem"></i>${esc(cat)}</span>`;
      }).join('<span class="mx-1" style="color:#cbd5e1">·</span>')}</div>` : '';

    return `
    <div class="te-trip-card${isDone ? ' te-trip-card--done' : ''}">
      <div class="te-trip-card-main">
        <div class="te-trip-icon-wrap"><i class="bi bi-airplane-fill"></i></div>
        <div class="te-trip-body">
          <div class="te-trip-top">
            <div class="te-trip-name">${esc(t.name)}</div>
            <div class="te-trip-chips">${statusChip}${timeC}</div>
          </div>
          <div class="te-trip-meta-row">
            ${t.destination ? `<span class="te-trip-meta-chip"><i class="bi bi-geo-alt-fill me-1"></i>${esc(t.destination)}</span>` : ''}
            <span class="te-trip-meta-chip"><i class="bi bi-calendar3 me-1"></i>${esc(dateRange)}</span>
          </div>
          ${t.participants?.length ? `<div class="te-avatars-row">${t.participants.map((p, i) => _avatarChip(p, i)).join('')}<span class="te-avatar-more">+you</span></div>` : ''}
          ${catBar}
        </div>
        <div class="te-trip-amount-col">
          <div class="te-trip-spent-label">Spent</div>
          <div class="te-trip-spent-val">${fmt(spent)}</div>
          ${pct !== null ? `<div class="te-trip-budget-pct" style="color:${barColor}">${pct.toFixed(0)}% of budget</div>` : ''}
        </div>
      </div>
      ${pct !== null ? `
      <div class="te-budget-bar-new"><div class="te-budget-fill" style="width:${pct.toFixed(1)}%;background:${barColor}"></div></div>
      ${pct >= 90 ? `<div class="te-budget-warn"><i class="bi bi-exclamation-triangle-fill me-1"></i>${pct.toFixed(0)}% of budget used — approaching limit</div>` : ''}` : ''}
      <div class="te-trip-footer">
        <button class="te-btn-ghost te-btn-ghost--view te-view-btn" data-trip-id="${esc(t.id)}"><i class="bi bi-eye-fill me-1"></i>View Trip</button>
        <div class="te-trip-footer-right">
          <button class="te-btn-ghost te-btn-ghost--danger te-del-trip-btn" data-trip-id="${esc(t.id)}"><i class="bi bi-trash3"></i></button>
        </div>
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.te-view-btn').forEach(btn =>
    btn.addEventListener('click', () => _openTripDetail(btn.dataset.tripId)));
  container.querySelectorAll('.te-del-trip-btn').forEach(btn =>
    btn.addEventListener('click', () => _deleteTrip(btn.dataset.tripId)));
}

// ─── Trip Detail ──────────────────────────────────────────────────────────────

function _openTripDetail(tripId) {
  _activeTripId = tripId;
  _el('te-trips-view')?.classList.add('d-none');
  _el('te-detail-view')?.classList.remove('d-none');
  _renderTripDetail(tripId);
}

function _closeTripDetail() {
  _activeTripId = null;
  _el('te-detail-view')?.classList.add('d-none');
  _el('te-trips-view')?.classList.remove('d-none');
}

function _renderTripDetail(tripId) {
  const trips    = store.get('trips') ?? [];
  const tripExps = store.get('tripExpenses') ?? [];
  const trip     = trips.find(t => t.id === tripId);
  if (!trip) return;

  const exps  = tripExps.filter(e => e.tripId === tripId).sort((a, b) => b.date.localeCompare(a.date));
  const total = exps.reduce((s, e) => s + e.amount, 0);

  // ── Detail hero
  const heroEl = _el('te-detail-hero');
  if (heroEl) {
    const isActive  = trip.status === 'active';
    const dateRange = trip.endDate
      ? `${formatDate(trip.startDate)} – ${formatDate(trip.endDate)}`
      : `From ${formatDate(trip.startDate)}`;
    const pct = trip.budget > 0 ? Math.min((total / trip.budget) * 100, 100) : null;
    heroEl.innerHTML = `
      <div class="te-detail-hero">
        <div class="te-dh-top-bar">
          <button class="te-btn-ghost te-btn-ghost--white" id="te-back-btn"><i class="bi bi-arrow-left me-1"></i>All Trips</button>
        </div>
        <div class="te-dh-main">
          <div class="te-dh-icon"><i class="bi bi-airplane-fill"></i></div>
          <div class="te-dh-info">
            <div class="te-dh-name">${esc(trip.name)}</div>
            <div class="te-dh-meta">
              ${trip.destination ? `<span class="te-dh-chip"><i class="bi bi-geo-alt-fill me-1"></i>${esc(trip.destination)}</span>` : ''}
              <span class="te-dh-chip"><i class="bi bi-calendar3 me-1"></i>${esc(dateRange)}</span>
              ${pct !== null ? `<span class="te-dh-chip te-dh-budget-chip"><i class="bi bi-bullseye me-1"></i>Budget ${fmt(trip.budget)} &nbsp;·&nbsp; ${pct.toFixed(0)}% used</span>` : ''}
              <span class="te-dh-status-chip ${isActive ? 'te-dh-status-chip--active' : 'te-dh-status-chip--done'}">${isActive ? 'Active' : 'Completed'}</span>
            </div>
            ${trip.participants?.length ? `<div class="te-avatars-row mt-2">${trip.participants.map((p, i) => _avatarChip(p, i)).join('')}<span class="te-avatar-more" style="color:rgba(255,255,255,.7)">+you</span></div>` : ''}
          </div>
        </div>
        <div class="te-dh-actions">
          <button class="btn te-add-btn" id="te-add-exp-btn"><i class="bi bi-plus-circle-fill me-2"></i>Add Expense</button>
          <button class="te-btn-ghost te-btn-ghost--white" id="te-status-btn">
            ${isActive ? '<i class="bi bi-check-circle me-1"></i>Mark Complete' : '<i class="bi bi-arrow-counterclockwise me-1"></i>Reopen'}
          </button>
        </div>
      </div>`;

    _el('te-back-btn')?.addEventListener('click', _closeTripDetail);
    _el('te-add-exp-btn')?.addEventListener('click', _openAddExpenseModal);
    _el('te-status-btn')?.addEventListener('click', async () => {
      if (trip.status === 'active') {
        const ok = await epConfirm('Mark this trip as completed? You can reopen it later.');
        if (!ok) return;
      }
      await _toggleTripStatus(tripId);
      _renderTripDetail(tripId);
    });
  }

  // ── Summary stats (tint variants)
  const summaryEl = _el('te-detail-summary');
  if (summaryEl) {
    const headCount = (trip.participants?.length ?? 0) + 1;
    const perPerson = total / headCount;
    const budgetLeft = trip.budget > 0 ? trip.budget - total : null;
    const days = (trip.startDate && trip.endDate)
      ? Math.max(1, Math.round((new Date(trip.endDate + 'T00:00:00') - new Date(trip.startDate + 'T00:00:00')) / 86400000) + 1)
      : null;
    const fourth = budgetLeft !== null
      ? `<div class="sec-stat-card sec-stat-card--tint-${budgetLeft < 0 ? 'red' : 'green'}">
          <div class="sec-stat-icon" style="background:linear-gradient(135deg,${budgetLeft < 0 ? '#ef4444,#f87171' : '#10b981,#34d399'})"><i class="bi bi-bullseye"></i></div>
          <div class="sec-stat-body"><div class="sec-stat-label">${budgetLeft < 0 ? 'Over Budget' : 'Budget Left'}</div><div class="sec-stat-value">${fmt(Math.abs(budgetLeft))}</div></div>
        </div>`
      : days
      ? `<div class="sec-stat-card sec-stat-card--tint-blue">
          <div class="sec-stat-icon" style="background:linear-gradient(135deg,#3b82f6,#60a5fa)"><i class="bi bi-calendar-week"></i></div>
          <div class="sec-stat-body"><div class="sec-stat-label">Avg / Day</div><div class="sec-stat-value">${fmt(Math.round(total / days))}</div></div>
        </div>`
      : '';
    summaryEl.innerHTML = `
      <div class="sec-stat-card sec-stat-card--tint-purple">
        <div class="sec-stat-icon" style="background:linear-gradient(135deg,#6366f1,#818cf8)"><i class="bi bi-receipt-cutoff"></i></div>
        <div class="sec-stat-body"><div class="sec-stat-label">Total Spent</div><div class="sec-stat-value">${fmt(total)}</div></div>
      </div>
      <div class="sec-stat-card sec-stat-card--tint-amber">
        <div class="sec-stat-icon" style="background:linear-gradient(135deg,#f59e0b,#fbbf24)"><i class="bi bi-people-fill"></i></div>
        <div class="sec-stat-body"><div class="sec-stat-label">Per person (incl. you)</div><div class="sec-stat-value">${fmt(Math.round(perPerson))}</div></div>
      </div>
      <div class="sec-stat-card sec-stat-card--tint-green">
        <div class="sec-stat-icon" style="background:linear-gradient(135deg,#10b981,#34d399)"><i class="bi bi-receipt"></i></div>
        <div class="sec-stat-body"><div class="sec-stat-label">Expenses</div><div class="sec-stat-value">${exps.length}</div></div>
      </div>
      ${fourth}`;
  }

  // ── Split summary
  _renderSplitSummary(trip, exps);

  // ── Expenses list — day-grouped
  const listEl = _el('te-exp-list');
  if (!listEl) return;

  const expCountEl = _el('te-exp-count');
  if (expCountEl) expCountEl.textContent = exps.length || '';

  if (!exps.length) {
    listEl.innerHTML = `<div class="ep-empty-state" style="padding:2rem 1rem">
      <div class="ep-es-icon-wrap" style="background:linear-gradient(135deg,#3b82f6,#2563eb);box-shadow:0 8px 32px rgba(59,130,246,.25);width:52px;height:52px;font-size:1.3rem"><i class="bi bi-bag-x"></i></div>
      <div class="ep-es-title">No expenses yet</div>
      <div class="ep-es-subtitle">Add the first expense to start tracking.</div>
    </div>`;
    return;
  }

  // Group by date
  const grouped = {};
  exps.forEach(e => { (grouped[e.date] = grouped[e.date] || []).push(e); });
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  listEl.innerHTML = sortedDates.map(date => {
    const dayExps  = grouped[date];
    const dayTotal = dayExps.reduce((s, e) => s + e.amount, 0);
    const dayNum   = _dayNumber(trip.startDate, date);
    const dayLabel = dayNum ? `Day ${dayNum} — ${formatDate(date)}` : formatDate(date);
    return `
    <div class="te-day-group">
      <div class="te-day-header">
        <span class="te-day-label">${esc(dayLabel)}</span>
        <span class="te-day-total">${fmt(dayTotal)}</span>
      </div>
      ${dayExps.map(e => {
        const splitBadge = e.splitWith?.length
          ? `<span class="te-split-badge"><i class="bi bi-people-fill me-1"></i>Split ${e.splitType === 'equal' ? 'equally' : 'custom'} with ${e.splitWith.join(', ')}</span>`
          : '';
        const paidByBadge = e.paidBy !== 'Me'
          ? `<span class="te-paidby-badge"><i class="bi bi-person-fill me-1"></i>Paid by ${esc(e.paidBy)}</span>`
          : '';
        const pmText = e.paymentType === 'Cash' ? 'Cash' : e.paymentMethod;
        return `
        <div class="te-exp-row">
          <div class="te-exp-icon-col">${_catIconHtml(e.category)}</div>
          <div class="te-exp-left">
            <div class="te-exp-desc">${esc(e.description)}</div>
            <div class="te-exp-meta">
              <span><i class="bi bi-tag-fill me-1"></i>${esc(e.category)}${e.subCategory ? ' › ' + esc(e.subCategory) : ''}</span>
              <span><i class="bi bi-wallet2 me-1"></i>${esc(pmText)}</span>
              ${paidByBadge}${splitBadge}
            </div>
          </div>
          <div class="te-exp-right">
            <div class="te-exp-amount">${fmt(e.amount)}</div>
            <button class="te-del-exp-btn" data-exp-id="${esc(e.id)}" title="Delete"><i class="bi bi-trash3"></i></button>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');

  listEl.querySelectorAll('.te-del-exp-btn').forEach(btn =>
    btn.addEventListener('click', () => _deleteTripExp(btn.dataset.expId)));
}

function _renderSplitSummary(trip, exps) {
  const container = _el('te-split-summary');
  if (!container) return;

  const allPeople = ['Me', ...(trip.participants ?? [])];
  const owes = {};
  allPeople.forEach(p => { owes[p] = 0; });

  exps.forEach(e => {
    if (!e.splitWith?.length || e.splitType === 'none') return;
    const payer = e.paidBy;
    if (e.splitType === 'equal') {
      const each = e.amount / (e.splitWith.length + 1);
      e.splitWith.forEach(person => {
        if (payer === 'Me') owes[person] = (owes[person] ?? 0) + each;
        else if (person === 'Me') owes['Me'] = (owes['Me'] ?? 0) - each;
      });
    } else {
      Object.entries(e.customSplits ?? {}).forEach(([person, amt]) => {
        if (payer === 'Me') owes[person] = (owes[person] ?? 0) + Number(amt);
        else if (person === 'Me') owes['Me'] = (owes['Me'] ?? 0) - Number(amt);
      });
    }
  });

  const rows = Object.entries(owes).filter(([p, v]) => p !== 'Me' && Math.abs(v) > 0.01);
  if (!rows.length) {
    container.innerHTML = '<div class="te-split-clear"><i class="bi bi-check-circle-fill me-2"></i>All settled — no pending splits.</div>';
    return;
  }

  const totalOwedToMe = rows.filter(([, v]) => v >  0.01).reduce((s, [, v]) => s + v, 0);
  const totalIOwe     = rows.filter(([, v]) => v < -0.01).reduce((s, [, v]) => s + Math.abs(v), 0);

  container.innerHTML = rows.map(([person, amount]) => {
    const idx = (trip.participants ?? []).indexOf(person);
    return `
    <div class="te-split-row">
      ${_avatarChip(person, idx >= 0 ? idx : 0)}
      <span class="te-split-person">${esc(person)}</span>
      <div class="ms-auto">
        ${amount > 0
          ? `<span class="te-split-owes-chip te-split-owes-chip--green"><i class="bi bi-arrow-down-circle-fill me-1"></i>Owes you ${fmt(Math.abs(amount))}</span>`
          : `<span class="te-split-owes-chip te-split-owes-chip--red"><i class="bi bi-arrow-up-circle-fill me-1"></i>You owe ${fmt(Math.abs(amount))}</span>`
        }
      </div>
    </div>`;
  }).join('') + `<div class="te-split-total">
    ${totalOwedToMe > 0.01 ? `<span class="te-split-owes-chip te-split-owes-chip--green"><i class="bi bi-sigma me-1"></i>Total owed to you: ${fmt(totalOwedToMe)}</span>` : ''}
    ${totalIOwe     > 0.01 ? `<span class="te-split-owes-chip te-split-owes-chip--red"><i class="bi bi-sigma me-1"></i>You owe total: ${fmt(totalIOwe)}</span>` : ''}
  </div>`;
}

// ─── Add Expense ──────────────────────────────────────────────────────────────

async function _addTripExpense(formData) {
  const id = crypto.randomUUID();
  const exp = { id, ...formData };

  // 1. Save to TripExpenses sheet
  await appendRow(CONFIG.sheets.tripExpenses, serializeTripExp(exp));

  // 2. Auto-add to main Expenses if paid by Me
  let linkedExpenseId = '';
  if (exp.paidBy === 'Me') {
    const mainExpRow = serializeExpense({
      date:          exp.date,
      category:      exp.category,
      subCategory:   exp.subCategory ?? '',
      amount:        exp.amount,
      description:   `${exp.description} [trip:${exp.tripId}]`,
      paymentMethod: exp.paymentType === 'Cash' ? 'Cash' : exp.paymentMethod,
    });
    await appendRow(CONFIG.sheets.expenses, mainExpRow);

    // Reload expenses
    const expRows = await fetchRows(CONFIG.sheets.expenses);
    const { deserialize: deExp } = await import('./expenses.js');
    store.set('expenses', expRows.map(deExp));
    linkedExpenseId = id;
    exp.linkedExpenseId = linkedExpenseId;
  }

  // 3. Create lending entries for split
  if (exp.splitWith?.length && exp.splitType !== 'none' && exp.paidBy === 'Me') {
    await _createSplitLending(exp);
  }

  // 4. Reload trip expenses from sheet
  const teRows = await fetchRows(CONFIG.sheets.tripExpenses);
  store.set('tripExpenses', teRows.map(deserializeTripExp).filter(e => e.id && e.tripId));
}

async function _createSplitLending(exp) {
  const { serialize: serLend } = await import('./lendings.js');
  const existing = store.get('lendings') ?? [];
  const newLendings = [];

  const teTag = `[te:${exp.id}]`;
  if (exp.splitType === 'equal') {
    const each = exp.amount / (exp.splitWith.length + 1); // each person's share
    for (const person of exp.splitWith) {
      const entry = {
        id:           crypto.randomUUID(),
        type:         'lent',
        counterparty: person,
        amount:       parseFloat(each.toFixed(2)),
        date:         exp.date,
        description:  `${exp.description} (trip split)${teTag}`,
        status:       'pending',
      };
      await appendRow(CONFIG.sheets.lendings, serLend(entry));
      newLendings.push(entry);
    }
  } else if (exp.splitType === 'custom') {
    for (const [person, amt] of Object.entries(exp.customSplits ?? {})) {
      if (Number(amt) <= 0) continue;
      const entry = {
        id:           crypto.randomUUID(),
        type:         'lent',
        counterparty: person,
        amount:       parseFloat(Number(amt).toFixed(2)),
        date:         exp.date,
        description:  `${exp.description} (trip split)${teTag}`,
        status:       'pending',
      };
      await appendRow(CONFIG.sheets.lendings, serLend(entry));
      newLendings.push(entry);
    }
  }

  store.set('lendings', [...existing, ...newLendings]);
}

// ─── Delete ───────────────────────────────────────────────────────────────────

async function _deleteTrip(tripId) {
  const ok = await epConfirm('Delete this trip and all its expenses? This cannot be undone.');
  if (!ok) return;

  const allTrips    = store.get('trips') ?? [];
  const allTripExps = store.get('tripExpenses') ?? [];
  const deletedExps = allTripExps.filter(e => e.tripId === tripId);

  // 1. Remove trip + its expenses
  await writeAllRows(CONFIG.sheets.trips,        allTrips.filter(t => t.id !== tripId).map(serializeTrip));
  await writeAllRows(CONFIG.sheets.tripExpenses,  allTripExps.filter(e => e.tripId !== tripId).map(serializeTripExp));
  store.set('trips',        allTrips.filter(t => t.id !== tripId));
  store.set('tripExpenses', allTripExps.filter(e => e.tripId !== tripId));

  // 2. Remove all mirrored main expenses for this trip (description contains [trip:tripId])
  const allExps  = store.get('expenses') ?? [];
  const newExps  = allExps.filter(e => !String(e.description ?? '').includes(`[trip:${tripId}]`));
  if (newExps.length !== allExps.length) {
    await writeAllRows(CONFIG.sheets.expenses, newExps.map(serializeExpense));
    store.set('expenses', newExps);
  }

  // 3. Remove lending entries linked to any expense of this trip
  if (deletedExps.length) {
    const expIds  = new Set(deletedExps.map(e => e.id));
    const legacyDescriptions = new Set(deletedExps.map(e => `${e.description} (trip split)`));
    const legacyDates        = new Set(deletedExps.map(e => e.date));
    const allLendings  = store.get('lendings') ?? [];
    const newLendings  = allLendings.filter(l => {
      const d = l.description ?? '';
      for (const eid of expIds) { if (d.includes(`[te:${eid}]`)) return false; }
      return !(legacyDescriptions.has(d) && legacyDates.has(l.date));
    });
    if (newLendings.length !== allLendings.length) {
      const { serialize: sLend } = await import('./lendings.js');
      await writeAllRows(CONFIG.sheets.lendings, newLendings.map(sLend));
      store.set('lendings', newLendings);
    }
  }

  if (_activeTripId === tripId) _closeTripDetail();
}

async function _deleteTripExp(expId) {
  const allTripExps = store.get('tripExpenses') ?? [];
  const exp = allTripExps.find(e => e.id === expId);
  if (!exp) return;

  const ok = await epConfirm('Delete this expense? The linked expense entry and any split lending records will also be removed.');
  if (!ok) return;

  // 1. Remove from TripExpenses
  await writeAllRows(CONFIG.sheets.tripExpenses, allTripExps.filter(e => e.id !== expId).map(serializeTripExp));
  store.set('tripExpenses', allTripExps.filter(e => e.id !== expId));

  // 2. Remove mirrored main expense (only created when paidBy === 'Me')
  if (exp.paidBy === 'Me') {
    const allExps = store.get('expenses') ?? [];
    const expectedDesc = `${exp.description} [trip:${exp.tripId}]`;
    const newExps = allExps.filter(e => !(e.description === expectedDesc && e.date === exp.date));
    if (newExps.length !== allExps.length) {
      await writeAllRows(CONFIG.sheets.expenses, newExps.map(serializeExpense));
      store.set('expenses', newExps);
    }
  }

  // 3. Remove lending entries for this expense
  // New entries carry [te:expId] tag; legacy entries matched by description + date
  const allLendings   = store.get('lendings') ?? [];
  const legacyDesc    = `${exp.description} (trip split)`;
  const newLendings   = allLendings.filter(l => {
    const d = l.description ?? '';
    if (d.includes(`[te:${expId}]`)) return false;
    if (d === legacyDesc && l.date === exp.date) return false;
    return true;
  });
  if (newLendings.length !== allLendings.length) {
    const { serialize: sLend } = await import('./lendings.js');
    await writeAllRows(CONFIG.sheets.lendings, newLendings.map(sLend));
    store.set('lendings', newLendings);
  }
}

// ─── Category Dropdowns ───────────────────────────────────────────────────────

function _refreshTripCatDropdown() {
  const catSel = _el('te-exp-category');
  if (!catSel) return;
  const cats = store.get('expenseCategories') ?? [];
  const prev = catSel.value;
  catSel.innerHTML = `<option value="">Select category</option>${cats.map(c => `<option value="${esc(c.name)}"${c.name === prev ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}`;
  _refreshTripSubCatDropdown();
}

function _refreshTripSubCatDropdown() {
  const catSel    = _el('te-exp-category');
  const subCatSel = _el('te-exp-subcategory');
  if (!catSel || !subCatSel) return;
  const subs = (store.get('subCategories') ?? []).filter(s => s.category === catSel.value);
  subCatSel.innerHTML = `<option value="">None</option>${subs.map(s => `<option value="${esc(s.subCategory)}">${esc(s.subCategory)}</option>`).join('')}`;
}

// ─── Split UI helpers ─────────────────────────────────────────────────────────

function _populateSplitParticipants(tripId) {
  const trip = (store.get('trips') ?? []).find(t => t.id === tripId);
  const container = _el('te-exp-split-people');
  if (!container) return;
  const people = trip?.participants ?? [];
  if (!people.length) {
    container.innerHTML = '<p class="text-muted small">No participants in this trip.</p>';
    return;
  }
  container.innerHTML = people.map(p => `
    <label class="te-split-check">
      <input type="checkbox" class="te-split-person-cb" value="${esc(p)}" checked>
      ${esc(p)}
    </label>`).join('');

  container.querySelectorAll('.te-split-person-cb').forEach(cb => {
    cb.addEventListener('change', _refreshCustomSplitInputs);
  });
}

function _refreshCustomSplitInputs() {
  const container  = _el('te-custom-splits-wrap');
  if (!container) return;
  const type = _el('te-exp-split-type')?.value;
  if (type !== 'custom') { container.innerHTML = ''; return; }

  const checked = [...document.querySelectorAll('.te-split-person-cb:checked')].map(c => c.value);
  const amount  = parseFloat(_el('te-exp-amount')?.value) || 0;
  const myShare = amount / (checked.length + 1);

  container.innerHTML = `
    <div class="small text-muted mb-1">Your share: ${fmt(myShare)}</div>
    ${checked.map(p => `
    <div class="d-flex align-items-center gap-2 mb-2">
      <label class="fw-semibold small flex-shrink-0" style="min-width:90px">${esc(p)}</label>
      <input type="number" class="form-control form-control-sm te-custom-input" data-person="${esc(p)}" placeholder="0" min="0" step="0.01" value="${myShare.toFixed(2)}">
    </div>`).join('')}`;
}

// ─── Form Bindings ────────────────────────────────────────────────────────────

function _bindCreateTripForm() {
  const form = _el('te-create-trip-form');
  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn   = form.querySelector('[type=submit]');
    const name  = _el('te-trip-name')?.value.trim();
    const start = _el('te-trip-start')?.value;
    if (!name || !start) return;

    btn.disabled = true;
    btn.textContent = 'Creating…';

    try {
      const trip = {
        id:           crypto.randomUUID(),
        name,
        destination:  _el('te-trip-dest')?.value.trim() ?? '',
        startDate:    start,
        endDate:      _el('te-trip-end')?.value ?? '',
        participants: (_el('te-trip-participants')?.value ?? '').split(',').map(s => s.trim()).filter(Boolean),
        budget:       parseFloat(_el('te-trip-budget')?.value) || 0,
        status:       'active',
        note:         _el('te-trip-note')?.value.trim() ?? '',
      };
      await appendRow(CONFIG.sheets.trips, serializeTrip(trip));
      const rows = await fetchRows(CONFIG.sheets.trips);
      store.set('trips', rows.map(deserializeTrip).filter(t => t.id && t.name));
      form.reset();
      bootstrap.Modal.getInstance(_el('oc-create-trip'))?.hide();
    } catch (err) {
      _showErr('te-create-trip-error', err.message ?? 'Failed to create trip.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create Trip';
    }
  });
}

function _bindAddExpenseForm() {
  const form = _el('te-add-exp-form');
  if (!form) return;

  // Payment method dependency
  const refreshPay = bindDependentPaymentSelect('te-exp-pay-type', 'te-exp-pay-method', store);
  store.on('accounts',    refreshPay);
  store.on('creditCards', refreshPay);

  // Category → sub-category
  _el('te-exp-category')?.addEventListener('change', _refreshTripSubCatDropdown);

  // Split toggle
  _el('te-exp-split-toggle')?.addEventListener('change', function () {
    const wrap = _el('te-exp-split-wrap');
    if (wrap) wrap.classList.toggle('d-none', !this.checked);
    if (this.checked && _activeTripId) _populateSplitParticipants(_activeTripId);
  });

  // Split type → custom inputs
  _el('te-exp-split-type')?.addEventListener('change', _refreshCustomSplitInputs);
  _el('te-exp-amount')?.addEventListener('input', _refreshCustomSplitInputs);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!_activeTripId) return;

    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Adding…';
    _hideErr('te-add-exp-error');

    try {
      const splitOn   = _el('te-exp-split-toggle')?.checked ?? false;
      const splitType = splitOn ? (_el('te-exp-split-type')?.value ?? 'equal') : 'none';
      const splitWith = splitOn
        ? [...document.querySelectorAll('.te-split-person-cb:checked')].map(c => c.value)
        : [];
      const customSplits = {};
      if (splitType === 'custom') {
        document.querySelectorAll('.te-custom-input').forEach(inp => {
          customSplits[inp.dataset.person] = parseFloat(inp.value) || 0;
        });
      }

      await _addTripExpense({
        tripId:      _activeTripId,
        date:        _el('te-exp-date')?.value,
        category:    _el('te-exp-category')?.value,
        subCategory: _el('te-exp-subcategory')?.value ?? '',
        amount:      parseFloat(_el('te-exp-amount')?.value) || 0,
        description: _el('te-exp-desc')?.value.trim(),
        paymentType: _el('te-exp-pay-type')?.value ?? 'Cash',
        paymentMethod: _el('te-exp-pay-method')?.value ?? '',
        paidBy:      _el('te-exp-paid-by')?.value ?? 'Me',
        splitType,
        splitWith,
        customSplits,
      });

      form.reset();
      _el('te-exp-split-wrap')?.classList.add('d-none');
      bootstrap.Modal.getInstance(_el('oc-trip-expense'))?.hide();
    } catch (err) {
      _showErr('te-add-exp-error', err.message ?? 'Failed to add expense.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Add Expense';
    }
  });
}

// ─── Open Add Expense Modal ───────────────────────────────────────────────────

function _openAddExpenseModal() {
  if (!_activeTripId) return;
  const trip = (store.get('trips') ?? []).find(t => t.id === _activeTripId);

  // Set today's date
  const dateEl = _el('te-exp-date');
  if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().slice(0, 10);

  // Populate paid-by dropdown
  const paidBySel = _el('te-exp-paid-by');
  if (paidBySel && trip) {
    paidBySel.innerHTML = `<option value="Me">Me</option>${(trip.participants ?? []).map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}`;
  }

  _refreshTripCatDropdown();
  bootstrap.Modal.getOrCreateInstance(_el('oc-trip-expense')).show();
}

// ─── Mark trip complete ───────────────────────────────────────────────────────

async function _toggleTripStatus(tripId) {
  const trips = store.get('trips') ?? [];
  const trip  = trips.find(t => t.id === tripId);
  if (!trip) return;
  trip.status = trip.status === 'active' ? 'completed' : 'active';
  await writeAllRows(CONFIG.sheets.trips, trips.map(serializeTrip));
  store.set('trips', [...trips]);
}

// ─── Filter binding ───────────────────────────────────────────────────────────

function _updateTripResetBtn() {
  const btn = _el('te-reset-filters');
  if (!btn) return;
  btn.classList.toggle('d-none', !(_tripFilter.search || _tripFilter.status || _tripFilter.sort !== 'newest'));
}

function _bindTripFilters() {
  const searchEl = _el('te-search');
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      _tripFilter.search = searchEl.value;
      _updateTripResetBtn();
      _renderTripCards();
    });
  }

  document.querySelectorAll('[data-te-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      _tripFilter.status = btn.dataset.tePreset;
      document.querySelectorAll('[data-te-preset]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _updateTripResetBtn();
      _renderTripCards();
    });
  });

  const sortEl = _el('te-sort');
  if (sortEl) {
    sortEl.addEventListener('change', () => {
      _tripFilter.sort = sortEl.value;
      _updateTripResetBtn();
      _renderTripCards();
    });
  }

  const resetBtn = _el('te-reset-filters');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      _tripFilter.search = ''; _tripFilter.status = ''; _tripFilter.sort = 'newest';
      const s = _el('te-search'); if (s) s.value = '';
      const so = _el('te-sort');  if (so) so.value = 'newest';
      document.querySelectorAll('[data-te-preset]').forEach(b => b.classList.remove('active'));
      document.querySelector('[data-te-preset=""]')?.classList.add('active');
      _updateTripResetBtn();
      _renderTripCards();
    });
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function init() {
  _bindCreateTripForm();
  _bindAddExpenseForm();
  _bindTripFilters();

  // te-back-btn, te-add-exp-btn and te-status-btn are bound inside _renderTripDetail()

  store.on('trips',             render);
  store.on('tripExpenses',      render);
  store.on('expenseCategories', _refreshTripCatDropdown);
  store.on('subCategories',     _refreshTripSubCatDropdown);
}
