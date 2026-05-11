// js/maid-attendance.js — Household Staff Attendance Tracker

import { CONFIG } from './config.js';
import { appendRow, writeAllRows } from './api.js';
import * as store from './store.js';
import { epConfirm } from './confirm.js';

// ─── Serialization — Maids ────────────────────────────────────────────────────
// Columns: id | name | joiningDate | monthlySalary | notes

export function serializeMaid(m) {
  return [m.id, m.name, m.joiningDate ?? '', String(m.monthlySalary ?? 0), m.notes ?? ''];
}

export function deserializeMaid(row) {
  return {
    id:            row[0] ?? '',
    name:          row[1] ?? '',
    joiningDate:   row[2] ?? '',
    monthlySalary: parseFloat(row[3]) || 0,
    notes:         row[4] ?? '',
  };
}

// ─── Serialization — Attendance ───────────────────────────────────────────────
// Columns: id | maidId | maidName | date | status

export function serializeAttendance(a) {
  return [a.id, a.maidId, a.maidName, a.date, a.status];
}

export function deserializeAttendance(row) {
  return {
    id:       row[0] ?? '',
    maidId:   row[1] ?? '',
    maidName: row[2] ?? '',
    date:     row[3] ?? '',
    status:   row[4] ?? 'present',
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(n) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function localYM() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ─── Module state ─────────────────────────────────────────────────────────────

let _viewMaidId = null;
let _viewYM     = localYM();
let _editMaidId = null;

// ─── Avatar / tenure helpers ─────────────────────────────────────────────────

function _initials(name) {
  return String(name ?? '').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
}

function _avatarColor(name) {
  const palette = [
    ['#6366f1','#4338ca'], ['#10b981','#059669'], ['#f59e0b','#d97706'],
    ['#ef4444','#dc2626'], ['#0ea5e9','#0284c7'], ['#8b5cf6','#7c3aed'],
    ['#ec4899','#db2777'], ['#14b8a6','#0d9488'],
  ];
  let h = 0;
  for (const c of String(name ?? '')) h = (h * 31 + c.charCodeAt(0)) & 0xFFFF;
  const [from, to] = palette[h % palette.length];
  return `linear-gradient(135deg,${from},${to})`;
}

function _tenure(joiningDate) {
  if (!joiningDate) return '';
  const months = (new Date().getFullYear() - new Date(joiningDate).getFullYear()) * 12
    + (new Date().getMonth() - new Date(joiningDate).getMonth());
  if (months < 1) return 'Just joined';
  if (months < 12) return `${months}mo`;
  const y = Math.floor(months / 12), m = months % 12;
  return m > 0 ? `${y}y ${m}mo` : `${y}y`;
}

// ─── Maid card ────────────────────────────────────────────────────────────────

function _renderMaidCard(maid, attendance) {
  const curYM       = localYM();
  const todayStr    = localToday();
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const monthLabel  = new Date().toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

  const monthAtt  = attendance.filter(a => a.maidId === maid.id && a.date.startsWith(curYM));
  const present   = monthAtt.filter(a => a.status === 'present').length;
  const halfDay   = monthAtt.filter(a => a.status === 'half-day').length;
  const absent    = monthAtt.filter(a => a.status === 'absent').length;
  const effective = present + halfDay * 0.5;
  const salaryEarned = maid.monthlySalary > 0 ? (effective / daysInMonth) * maid.monthlySalary : 0;
  const attPct    = daysInMonth > 0 ? Math.round((effective / daysInMonth) * 100) : 0;
  const barColor  = attPct >= 80 ? '#10b981' : attPct >= 60 ? '#f59e0b' : '#ef4444';

  const todayEntry = attendance.find(a => a.maidId === maid.id && a.date === todayStr);
  const todayBadge = todayEntry
    ? todayEntry.status === 'present'
      ? `<span class="badge bg-success-subtle text-success">Present</span>`
      : todayEntry.status === 'half-day'
      ? `<span class="badge bg-warning-subtle text-warning">Half-Day</span>`
      : `<span class="badge bg-danger-subtle text-danger">Absent</span>`
    : `<span class="badge bg-secondary-subtle text-secondary">Pending</span>`;

  const isViewing = _viewMaidId === maid.id;
  const tenure    = _tenure(maid.joiningDate);

  return `
  <div class="ma-maid-card${isViewing ? ' ma-maid-card--active' : ''}" data-cal-maid-id="${esc(maid.id)}">
    <div class="ma-maid-row1">
      <div class="ma-maid-avatar" style="background:${_avatarColor(maid.name)}">${_initials(maid.name)}</div>
      <div class="ma-maid-info">
        <div class="ma-maid-name-row">
          <span class="ma-maid-name">${esc(maid.name)}</span>
          ${todayBadge}
        </div>
        <div class="ma-maid-meta">
          ${maid.monthlySalary > 0 ? `<span class="ma-maid-salary"><i class="bi bi-wallet2 me-1"></i>${fmt(maid.monthlySalary)}/mo</span>` : ''}
          ${tenure ? `<span class="ma-maid-tenure"><i class="bi bi-calendar3 me-1"></i>${tenure}</span>` : ''}
        </div>
      </div>
      <div class="ma-maid-actions">
        <button class="btn btn-xs btn-outline-secondary ma-edit-btn" data-maid-id="${esc(maid.id)}" title="Edit"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-xs btn-outline-danger ma-delete-btn" data-maid-id="${esc(maid.id)}" title="Delete"><i class="bi bi-trash3"></i></button>
      </div>
    </div>
    <div class="ma-att-bar-header">
      <span class="ma-att-pct-label">Attendance · ${monthLabel}</span>
      <span class="ma-att-pct-value" style="color:${barColor}">${attPct}%</span>
    </div>
    <div class="ma-att-bar-wrap" title="${attPct}% attendance this month">
      <div class="ma-att-bar-fill" style="width:${attPct}%;background:${barColor}"></div>
    </div>
    <div class="ma-maid-row2">
      <span class="ma-pill ma-pill--present"><i class="bi bi-check-circle-fill me-1"></i>${present} Present</span>
      <span class="ma-pill ma-pill--half"><i class="bi bi-circle-half me-1"></i>${halfDay} Half</span>
      <span class="ma-pill ma-pill--absent"><i class="bi bi-x-circle-fill me-1"></i>${absent} Absent</span>
      ${maid.monthlySalary > 0 ? `<span class="ma-pill ma-pill--salary"><i class="bi bi-wallet2 me-1"></i>${fmt(salaryEarned)}</span>` : ''}
    </div>
  </div>`;
}

// ─── Calendar ─────────────────────────────────────────────────────────────────

function _renderCalendar(maid, attendance) {
  const [y, m] = _viewYM.split('-').map(Number);
  const firstDow    = new Date(y, m - 1, 1).getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const monthLabel  = new Date(y, m - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
  const todayStr    = localToday();

  const attMap = {};
  attendance
    .filter(a => a.maidId === maid.id && a.date.startsWith(_viewYM))
    .forEach(a => { attMap[a.date] = a.status; });

  const present  = Object.values(attMap).filter(s => s === 'present').length;
  const halfDay  = Object.values(attMap).filter(s => s === 'half-day').length;
  const absent   = Object.values(attMap).filter(s => s === 'absent').length;
  const effective = present + halfDay * 0.5;
  const salaryEarned = maid.monthlySalary > 0 ? (effective / daysInMonth) * maid.monthlySalary : 0;

  let cells = '';
  for (let i = 0; i < firstDow; i++) cells += `<div class="ma-cal-cell ma-cal-empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${_viewYM}-${String(d).padStart(2, '0')}`;
    const status  = attMap[dateStr];
    const cls     = status === 'present' ? 'ma-cal-present'
                  : status === 'half-day' ? 'ma-cal-half'
                  : status === 'absent'   ? 'ma-cal-absent'
                  : '';
    const todayCls = dateStr === todayStr ? ' ma-cal-today' : '';
    cells += `<div class="ma-cal-cell ${cls}${todayCls}" title="${dateStr}${status ? ': ' + status : ''}">
      <span class="ma-cal-dn">${d}</span>
    </div>`;
  }

  return `
  <div class="ma-cal-nav">
    <button class="btn btn-sm btn-outline-secondary" id="ma-cal-prev"><i class="bi bi-chevron-left"></i></button>
    <span class="ma-cal-title">${monthLabel} — ${esc(maid.name)}</span>
    <button class="btn btn-sm btn-outline-secondary" id="ma-cal-next"><i class="bi bi-chevron-right"></i></button>
  </div>
  <div class="ma-cal-legend">
    <span><span class="ma-leg ma-leg--present"></span>Present</span>
    <span><span class="ma-leg ma-leg--half"></span>Half-day</span>
    <span><span class="ma-leg ma-leg--absent"></span>Absent</span>
  </div>
  <div class="ma-cal-grid">
    ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => `<div class="ma-cal-dow">${d}</div>`).join('')}
    ${cells}
  </div>
  <div class="ma-cal-summary">
    <span class="ma-pill ma-pill--present"><i class="bi bi-check-circle-fill me-1"></i>${present} Present</span>
    <span class="ma-pill ma-pill--half"><i class="bi bi-circle-half me-1"></i>${halfDay} Half-day</span>
    <span class="ma-pill ma-pill--absent"><i class="bi bi-x-circle-fill me-1"></i>${absent} Absent</span>
    ${maid.monthlySalary > 0 ? `<span class="ma-pill ma-pill--salary"><i class="bi bi-wallet2 me-1"></i>${fmt(salaryEarned)} / ${fmt(maid.monthlySalary)}</span>` : ''}
  </div>`;
}

// ─── Main render ──────────────────────────────────────────────────────────────

export function render() {
  const maids      = store.get('maids') ?? [];
  const attendance = store.get('maidAttendance') ?? [];
  const todayStr   = localToday();
  const curYM      = localYM();

  const container = document.getElementById('ma-root');
  if (!container) return;

  const el = id => document.getElementById(id);
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();

  const totalSalaryEarned = maids.reduce((sum, maid) => {
    if (!maid.monthlySalary) return sum;
    const monthAtt = attendance.filter(a => a.maidId === maid.id && a.date.startsWith(curYM));
    const pres = monthAtt.filter(a => a.status === 'present').length;
    const half = monthAtt.filter(a => a.status === 'half-day').length;
    return sum + ((pres + half * 0.5) / daysInMonth) * maid.monthlySalary;
  }, 0);

  if (maids.length === 0) {
    if (el('ma-stat-total'))    el('ma-stat-total').textContent    = 0;
    if (el('ma-stat-present'))  el('ma-stat-present').textContent  = 0;
    if (el('ma-stat-absent'))   el('ma-stat-absent').textContent   = 0;
    if (el('ma-stat-unmarked')) el('ma-stat-unmarked').textContent = 0;
    if (el('ma-stat-salary'))   el('ma-stat-salary').textContent   = '₹0';
    const heroSub = el('ma-hero-sub');
    if (heroSub) heroSub.textContent = 'Track daily attendance for maids & household staff';
    container.innerHTML = `
    <div class="ep-empty-state">
      <div class="ep-es-icon-wrap" style="background:linear-gradient(135deg,#8b5cf6,#7c3aed);box-shadow:0 8px 32px rgba(139,92,246,.3)">
        <i class="bi bi-person-bounding-box"></i>
      </div>
      <div class="ep-es-title">No staff added yet</div>
      <div class="ep-es-subtitle">Add maids or household staff to start tracking their attendance.</div>
      <button class="btn ep-es-cta" style="background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;border:none"
        data-bs-toggle="modal" data-bs-target="#oc-maid">
        <i class="bi bi-plus-circle-fill me-2"></i>Add First Staff Member
      </button>
    </div>`;
    return;
  }

  const todayAtt     = attendance.filter(a => a.date === todayStr);
  const presentToday = todayAtt.filter(a => a.status === 'present').length;
  const absentToday  = todayAtt.filter(a => a.status === 'absent').length;
  const markedIds    = new Set(todayAtt.map(a => a.maidId));
  const notMarked    = maids.filter(m => !markedIds.has(m.id)).length;

  if (el('ma-stat-total'))    el('ma-stat-total').textContent    = maids.length;
  if (el('ma-stat-present'))  el('ma-stat-present').textContent  = presentToday;
  if (el('ma-stat-absent'))   el('ma-stat-absent').textContent   = absentToday;
  if (el('ma-stat-unmarked')) el('ma-stat-unmarked').textContent = notMarked;
  if (el('ma-stat-salary'))   el('ma-stat-salary').textContent   = fmt(totalSalaryEarned);

  const totalMonthSalary = maids.reduce((s, m) => s + (m.monthlySalary || 0), 0);
  if (el('ma-stat-total-sub'))    el('ma-stat-total-sub').textContent    = `${maids.length} on roster`;
  if (el('ma-stat-present-sub'))  el('ma-stat-present-sub').textContent  = `${presentToday} of ${maids.length} marked`;
  if (el('ma-stat-absent-sub'))   el('ma-stat-absent-sub').textContent   = `${absentToday} of ${maids.length} marked`;
  if (el('ma-stat-unmarked-sub')) el('ma-stat-unmarked-sub').textContent = notMarked > 0 ? `${notMarked} yet to mark` : 'All marked ✓';
  if (el('ma-stat-salary-sub'))   el('ma-stat-salary-sub').textContent   = totalMonthSalary > 0 ? `of ${fmt(totalMonthSalary)} total` : 'This month';

  const heroSub = el('ma-hero-sub');
  if (heroSub) {
    const parts = [`${maids.length} staff`];
    if (presentToday > 0) parts.push(`${presentToday} present today`);
    if (notMarked > 0)    parts.push(`${notMarked} pending`);
    heroSub.textContent = parts.join(' · ');
  }

  container.innerHTML = `
  ${_renderQuickMark(maids, attendance, todayStr)}
  <div class="card mb-3">
    <div class="card-header fw-semibold d-flex justify-content-between align-items-center">
      <span><span class="ma-card-hd-icon" style="background:linear-gradient(135deg,#8b5cf6,#7c3aed)"><i class="bi bi-people-fill"></i></span>Staff Members <span class="badge bg-secondary-subtle text-secondary rounded-pill ms-1">${maids.length}</span></span>
    </div>
    <div class="card-body p-3">
      <div class="ma-maids-grid">
        ${maids.map(m => _renderMaidCard(m, attendance)).join('')}
      </div>
    </div>
  </div>
  `;

  _bindPageEvents(maids, attendance);
}

// ─── Event binding ────────────────────────────────────────────────────────────

// ─── Quick Mark Panel ────────────────────────────────────────────────────────

function _renderQuickMark(maids, attendance, dateStr) {
  const attMap = {};
  attendance.filter(a => a.date === dateStr).forEach(a => { attMap[a.maidId] = a.status; });
  const isToday = dateStr === localToday();
  const pastWarn = !isToday ? `
    <div class="ma-past-date-warn d-flex align-items-center gap-2 mb-2">
      <i class="bi bi-exclamation-triangle-fill"></i>
      <span>Editing attendance for <strong>${new Date(dateStr + 'T00:00').toLocaleDateString('en-IN', { weekday:'short', day:'numeric', month:'long', year:'numeric' })}</strong></span>
    </div>` : '';

  return `
  <div class="card mb-3 ma-mark-card">
    <div class="card-header fw-semibold d-flex align-items-center gap-2">
      <i class="bi bi-pencil-square me-1 text-primary"></i>Mark Attendance
      <div class="ms-auto d-flex align-items-center gap-2">
        <label class="form-label mb-0 small text-muted">Date:</label>
        <input type="date" class="form-control form-control-sm" id="ma-quick-date" value="${dateStr}" style="width:145px" />
      </div>
    </div>
    <div class="card-body p-2">
      ${pastWarn}
      <div class="ma-all-present-bar">
        <button class="btn ma-all-present-btn" id="ma-mark-all-present">
          <i class="bi bi-check2-all me-1"></i>Mark All as Present
        </button>
      </div>
      <div class="ma-quick-grid">
        ${maids.map(m => {
          const status    = attMap[m.id] ?? null;
          const statusCls = status === 'present'  ? 'ma-quick-row--present'
                          : status === 'half-day' ? 'ma-quick-row--half'
                          : status === 'absent'   ? 'ma-quick-row--absent' : '';
          const pCls      = status === 'present'  ? 'btn-success'          : 'btn-outline-success';
          const hCls      = status === 'half-day' ? 'btn-warning text-dark' : 'btn-outline-warning';
          const aCls      = status === 'absent'   ? 'btn-danger'           : 'btn-outline-danger';
          return `
          <div class="ma-quick-row ${statusCls}" id="ma-qrow-${esc(m.id)}">
            <div class="ma-quick-avatar" style="background:${_avatarColor(m.name)}">${_initials(m.name)}</div>
            <span class="ma-quick-name">${esc(m.name)}</span>
            <div class="btn-group btn-group-sm ma-quick-btns">
              <button class="btn ${pCls} ma-quick-btn" data-maid-id="${esc(m.id)}" data-status="present"><i class="bi bi-check-lg"></i><span class="ma-quick-lbl"> Present</span></button>
              <button class="btn ${hCls} ma-quick-btn" data-maid-id="${esc(m.id)}" data-status="half-day"><i class="bi bi-circle-half"></i><span class="ma-quick-lbl"> Half Day</span></button>
              <button class="btn ${aCls} ma-quick-btn" data-maid-id="${esc(m.id)}" data-status="absent"><i class="bi bi-x-lg"></i><span class="ma-quick-lbl"> Absent</span></button>
            </div>
            <span class="ma-quick-spin d-none" id="ma-qs-${esc(m.id)}"><span class="spinner-border spinner-border-sm text-secondary"></span></span>
          </div>`;
        }).join('')}
      </div>
      <div id="ma-quick-error" class="text-danger mt-2 d-none small"></div>
    </div>
  </div>`;
}

async function _saveQuickAttendance(maidId, date, status) {
  const spin = document.getElementById(`ma-qs-${maidId}`);
  const row  = document.getElementById(`ma-qrow-${maidId}`);
  if (spin) spin.classList.remove('d-none');
  if (row)  row.querySelectorAll('.ma-quick-btn').forEach(b => (b.disabled = true));

  try {
    const maid   = (store.get('maids') ?? []).find(m => m.id === maidId);
    const allAtt = store.get('maidAttendance') ?? [];
    let updated;

    if (status === 'remove') {
      updated = allAtt.filter(a => !(a.maidId === maidId && a.date === date));
      await writeAllRows(CONFIG.sheets.maidAttendance, updated.map(serializeAttendance));
    } else {
      const existing = allAtt.find(a => a.maidId === maidId && a.date === date);
      if (existing) {
        updated = allAtt.map(a => (a.maidId === maidId && a.date === date) ? { ...a, status } : a);
        await writeAllRows(CONFIG.sheets.maidAttendance, updated.map(serializeAttendance));
      } else {
        const rec = { id: crypto.randomUUID(), maidId, maidName: maid?.name ?? '', date, status };
        await appendRow(CONFIG.sheets.maidAttendance, serializeAttendance(rec));
        updated = [...allAtt, rec];
      }
    }
    store.set('maidAttendance', updated);
  } catch (err) {
    const errEl = document.getElementById('ma-quick-error');
    if (errEl) { errEl.textContent = err.message || 'Failed to save.'; errEl.classList.remove('d-none'); }
    if (row) row.querySelectorAll('.ma-quick-btn').forEach(b => (b.disabled = false));
  } finally {
    if (spin) spin.classList.add('d-none');
  }
}

// ─── Event binding ────────────────────────────────────────────────────────────

function _bindPageEvents(maids, attendance) {
  document.querySelectorAll('.ma-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const maid = maids.find(m => m.id === btn.dataset.maidId);
      if (!maid) return;
      _viewMaidId = maid.id;
      _viewYM = localYM();
      _showCalModal(maid, attendance);
    });
  });

  document.querySelectorAll('.ma-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => _startEditMaid(btn.dataset.maidId));
  });

  document.querySelectorAll('.ma-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => _deleteMaid(btn.dataset.maidId));
  });

  // Mark All Present
  document.getElementById('ma-mark-all-present')?.addEventListener('click', async () => {
    const btn  = document.getElementById('ma-mark-all-present');
    const date = document.getElementById('ma-quick-date')?.value || localToday();
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Marking…'; }
    for (const m of maids) await _saveQuickAttendance(m.id, date, 'present');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-check2-all me-1"></i>All Present'; }
  });

  // Quick mark: date change re-renders grid + past-date warning
  document.getElementById('ma-quick-date')?.addEventListener('change', e => {
    const date = e.target.value;
    if (!date) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = _renderQuickMark(maids, store.get('maidAttendance') ?? [], date);
    const newGrid = tmp.querySelector('.ma-quick-grid');
    const oldGrid = document.querySelector('.ma-quick-grid');
    if (newGrid && oldGrid) oldGrid.replaceWith(newGrid);
    const newWarn = tmp.querySelector('.ma-past-date-warn');
    const oldWarn = document.querySelector('.ma-past-date-warn');
    if (newWarn && oldWarn)       oldWarn.replaceWith(newWarn);
    else if (newWarn && !oldWarn) document.querySelector('.ma-quick-grid')?.insertAdjacentElement('beforebegin', newWarn);
    else if (!newWarn && oldWarn) oldWarn.remove();
    _bindQuickButtons(date);
  });

  // Clicking a staff card (outside buttons) opens calendar modal
  document.querySelectorAll('.ma-maid-card[data-cal-maid-id]').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      const maid = maids.find(m => m.id === card.dataset.calMaidId);
      if (!maid) return;
      _viewMaidId = maid.id;
      _viewYM = localYM();
      _showCalModal(maid, attendance);
    });
  });

  _bindQuickButtons(localToday());
}

function _bindQuickButtons(date) {
  document.querySelectorAll('.ma-quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = document.getElementById('ma-quick-date')?.value || date;
      _saveQuickAttendance(btn.dataset.maidId, d, btn.dataset.status);
    });
  });
}

function _bindCalNav(maids, attendance) {
  document.getElementById('ma-cal-prev')?.addEventListener('click', () => {
    const [y, m] = _viewYM.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    _viewYM = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    _refreshCalModal(maids, attendance);
  });
  document.getElementById('ma-cal-next')?.addEventListener('click', () => {
    const [y, m] = _viewYM.split('-').map(Number);
    const d = new Date(y, m, 1);
    _viewYM = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    _refreshCalModal(maids, attendance);
  });
}

function _showCalModal(maid, attendance) {
  const title = document.getElementById('ma-cal-modal-title');
  if (title) title.textContent = maid.name;
  _refreshCalModal([maid, ...((store.get('maids') ?? []).filter(m => m.id !== maid.id))], attendance);
  bootstrap.Modal.getOrCreateInstance(document.getElementById('oc-maid-cal')).show();
}

function _refreshCalModal(maids, attendance) {
  const body = document.getElementById('ma-cal-modal-body');
  const maid = maids.find(m => m.id === _viewMaidId);
  if (body && maid) {
    body.innerHTML = _renderCalendar(maid, attendance);
    _bindCalNav(maids, attendance);
  }
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

function _startEditMaid(id) {
  const maid = (store.get('maids') ?? []).find(m => m.id === id);
  if (!maid) return;
  _editMaidId = id;

  const f = i => document.getElementById(i);
  if (f('maid-name'))    f('maid-name').value    = maid.name;
  if (f('maid-joining')) f('maid-joining').value  = maid.joiningDate;
  if (f('maid-salary'))  f('maid-salary').value   = maid.monthlySalary || '';
  if (f('maid-notes'))   f('maid-notes').value    = maid.notes;

  const label = document.getElementById('oc-maid-label');
  if (label) label.innerHTML = '<i class="bi bi-pencil-fill me-2 text-warning"></i>Edit Staff Member';
  const btn = document.getElementById('maid-submit-btn');
  if (btn) btn.textContent = 'Save Changes';

  bootstrap.Modal.getOrCreateInstance(document.getElementById('oc-maid')).show();
}

async function _deleteMaid(id) {
  const maid = (store.get('maids') ?? []).find(m => m.id === id);
  if (!maid) return;
  const ok = await epConfirm(
    `Delete "${maid.name}"? All their attendance records will also be removed.`, 'danger'
  );
  if (!ok) return;

  try {
    const updatedMailds = (store.get('maids') ?? []).filter(m => m.id !== id);
    await writeAllRows(CONFIG.sheets.maids, updatedMailds.map(serializeMaid));
    store.set('maids', updatedMailds);

    const updatedAtt = (store.get('maidAttendance') ?? []).filter(a => a.maidId !== id);
    await writeAllRows(CONFIG.sheets.maidAttendance, updatedAtt.map(serializeAttendance));
    store.set('maidAttendance', updatedAtt);

    if (_viewMaidId === id) _viewMaidId = null;
  } catch (err) {
    console.error('[maid] delete failed:', err);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function init() {
  store.on('maids', render);
  store.on('maidAttendance', render);
  _bindMaidForm();
}

function _bindMaidForm() {
  const form = document.getElementById('maid-form');
  if (!form) return;

  const modal = document.getElementById('oc-maid');
  if (modal) {
    modal.addEventListener('hidden.bs.modal', () => {
      _editMaidId = null;
      form.reset();
      const label = document.getElementById('oc-maid-label');
      if (label) label.innerHTML = '<i class="bi bi-person-plus-fill me-2 text-primary"></i>Add Staff Member';
      const btn = document.getElementById('maid-submit-btn');
      if (btn) { btn.disabled = false; btn.textContent = 'Add Staff Member'; }
      document.getElementById('maid-name-err')?.classList.add('d-none');
    });
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const name          = document.getElementById('maid-name')?.value.trim() ?? '';
    const joiningDate   = document.getElementById('maid-joining')?.value ?? '';
    const monthlySalary = parseFloat(document.getElementById('maid-salary')?.value) || 0;
    const notes         = document.getElementById('maid-notes')?.value.trim() ?? '';

    const nameErr = document.getElementById('maid-name-err');
    if (!name) {
      if (nameErr) nameErr.classList.remove('d-none');
      return;
    }
    if (nameErr) nameErr.classList.add('d-none');

    const btn = document.getElementById('maid-submit-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    try {
      const all = store.get('maids') ?? [];
      if (_editMaidId) {
        const updated = all.map(m =>
          m.id === _editMaidId ? { ...m, name, joiningDate, monthlySalary, notes } : m
        );
        await writeAllRows(CONFIG.sheets.maids, updated.map(serializeMaid));
        store.set('maids', updated);
      } else {
        const rec = { id: crypto.randomUUID(), name, joiningDate, monthlySalary, notes };
        await appendRow(CONFIG.sheets.maids, serializeMaid(rec));
        store.set('maids', [...all, rec]);
      }
      bootstrap.Modal.getInstance(document.getElementById('oc-maid'))?.hide();
    } catch (err) {
      console.error('[maid] save failed:', err);
      if (btn) { btn.disabled = false; btn.textContent = _editMaidId ? 'Save Changes' : 'Add Staff Member'; }
    }
  });
}
