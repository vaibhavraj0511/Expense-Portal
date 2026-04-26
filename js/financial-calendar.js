// js/financial-calendar.js — Financial Calendar view

import * as store from './store.js';
import { calcEmi } from './loans.js';

let _calYear  = new Date().getFullYear();
let _calMonth = new Date().getMonth(); // 0-indexed

// ─── Active type filters (true = visible) ─────────────────────────────────────
const _filters = {
  bill:             true,
  subscription:     true,
  loan:             true,
  recurringIncome:  true,
  recurringExpense: true,
};

function _filterKey(ev) {
  if (ev.type === 'recurring') return ev.subType === 'income' ? 'recurringIncome' : 'recurringExpense';
  return ev.type;
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(n) {
  return '₹' + Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function _daysFromToday(targetDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(targetDate);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

// ─── Event type → Bootstrap icon ──────────────────────────────────────────────
function _evIcon(ev) {
  if (ev.type === 'bill')         return 'bi-receipt';
  if (ev.type === 'subscription') return 'bi-collection-play-fill';
  if (ev.type === 'loan')         return 'bi-bank2';
  if (ev.type === 'recurring')    return ev.subType === 'income' ? 'bi-arrow-down-circle-fill' : 'bi-arrow-repeat';
  return 'bi-circle-fill';
}

// ─── Collect events for a given month ────────────────────────────────────────

function _getEventsForMonth(year, month) {
  const events = {}; // day (1-31) → array of event objects

  const addEvent = (day, event) => {
    if (day < 1 || day > 31) return;
    if (!events[day]) events[day] = [];
    events[day].push(event);
  };

  // 1. Bills
  const bills = store.get('bills') ?? [];
  bills.filter(b => b.active).forEach(b => {
    const d = Number(b.dueDay);
    if (!d) return;
    if (b.frequency === 'monthly') {
      addEvent(d, { type: 'bill', label: b.name, amount: b.amount, icon: 'bi-receipt', color: '#ef4444' });
    } else if (b.frequency === 'yearly') {
      const billMonth = b.dueMonth ? Number(b.dueMonth) - 1 : 0;
      if (billMonth === month) {
        addEvent(d, { type: 'bill', label: b.name, amount: b.amount, icon: 'bi-receipt', color: '#ef4444' });
      }
    } else if (b.frequency === 'quarterly') {
      const startMonth = b.dueMonth ? Number(b.dueMonth) - 1 : 0;
      if ((month - startMonth + 12) % 3 === 0) {
        addEvent(d, { type: 'bill', label: b.name, amount: b.amount, icon: 'bi-receipt', color: '#ef4444' });
      }
    }
  });

  // 2. Subscriptions — FIX: project billing date forward to the viewed month
  const subs = store.get('subscriptions') ?? [];
  subs.filter(s => s.active !== false && s.nextBillingDate).forEach(s => {
    const next = new Date(s.nextBillingDate + 'T00:00:00');
    if (isNaN(next)) return;

    if (s.billingCycle === 'monthly') {
      // Monthly always recurs: use the stored day-of-month for every month
      addEvent(next.getDate(), { type: 'subscription', label: s.name, amount: s.amount, icon: 'bi-collection-play-fill', color: '#8b5cf6' });
    } else {
      // For other cycles, project from nextBillingDate forward until we reach or pass the viewed month
      let projected = new Date(next);
      while (projected.getFullYear() < year || (projected.getFullYear() === year && projected.getMonth() < month)) {
        switch (s.billingCycle) {
          case 'weekly':      projected.setDate(projected.getDate() + 7); break;
          case 'quarterly':   projected.setMonth(projected.getMonth() + 3); break;
          case 'half-yearly': projected.setMonth(projected.getMonth() + 6); break;
          case 'yearly':      projected.setFullYear(projected.getFullYear() + 1); break;
          default:            projected.setMonth(projected.getMonth() + 1);
        }
      }
      if (projected.getFullYear() === year && projected.getMonth() === month) {
        addEvent(projected.getDate(), { type: 'subscription', label: s.name, amount: s.amount, icon: 'bi-collection-play-fill', color: '#8b5cf6' });
      }
    }
  });

  // 3. Loan EMIs — FIX: skip months after the loan's payoff date
  const loans = store.get('loans') ?? [];
  loans.filter(l => l.status === 'active' && l.startDate).forEach(l => {
    const startDate = new Date(l.startDate + 'T00:00:00');
    const startDay  = startDate.getDate();
    if (!startDay) return;

    // Calculate payoff date and skip if the viewed month is beyond it
    const payoffDate = new Date(startDate);
    payoffDate.setMonth(payoffDate.getMonth() + (l.tenureMonths || 0));
    if (new Date(year, month, 1) > payoffDate) return;

    const emiAmt = calcEmi(l.principal, l.interestRate, l.tenureMonths);
    addEvent(startDay, { type: 'loan', label: l.name || l.loanType || 'Loan EMI', amount: Math.round(emiAmt), icon: 'bi-bank2', color: '#3b82f6' });
  });

  // 4. Recurring (expense/income) — FIX: derive yearly month from startDate
  const recurring = store.get('recurring') ?? [];
  recurring.filter(r => !r.paused).forEach(r => {
    const isIncome = r.type === 'income';
    const color    = isIncome ? '#10b981' : '#f59e0b';
    const subType  = isIncome ? 'income' : 'expense';
    const icon     = isIncome ? 'bi-arrow-down-circle-fill' : 'bi-arrow-repeat';

    if (r.frequency === 'monthly' && r.day) {
      addEvent(Number(r.day), { type: 'recurring', subType, label: r.description || r.category, amount: r.amount, icon, color });
    } else if (r.frequency === 'weekly' && r.day !== undefined) {
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        if (new Date(year, month, d).getDay() === Number(r.day)) {
          addEvent(d, { type: 'recurring', subType, label: r.description || r.category, amount: r.amount, icon: 'bi-arrow-repeat', color });
        }
      }
    } else if (r.frequency === 'yearly' && r.day) {
      // FIX: use startDate to derive the correct month instead of the missing r.month field
      const recMonth = r.startDate ? new Date(r.startDate + 'T00:00:00').getMonth() : 0;
      if (recMonth === month) {
        addEvent(Number(r.day), { type: 'recurring', subType, label: r.description || r.category, amount: r.amount, icon, color });
      }
    }
  });

  return events;
}

// ─── Upcoming events for the next N days ──────────────────────────────────────

function _getUpcomingEvents(days) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const result = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
    const monthEvents = _getEventsForMonth(y, m);
    (monthEvents[day] ?? []).forEach(ev => result.push({ ...ev, date: new Date(d) }));
  }
  return result;
}

// ─── Day detail popup ─────────────────────────────────────────────────────────

function _showDayPopup(day, year, month, events, anchorEl) {
  document.getElementById('fin-cal-popup')?.remove();
  if (!events || events.length === 0) return;

  const dateLabel = new Date(year, month, day).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const typeMap = { bill: 'Bill', subscription: 'Subscription', loan: 'Loan EMI' };

  let evHtml = events.map(ev => {
    const typeLabel = ev.type === 'recurring' ? (ev.subType === 'income' ? 'Recurring Income' : 'Recurring Expense') : (typeMap[ev.type] ?? ev.type);
    return `<div class="fin-cal-popup-event">
      <span class="fin-cal-popup-dot" style="background:${ev.color}"></span>
      <div class="fin-cal-popup-ev-info">
        <span class="fin-cal-popup-ev-label">${esc(ev.label)}</span>
        <span class="fin-cal-popup-ev-type">${esc(typeLabel)}</span>
      </div>
      <span class="fin-cal-popup-ev-amt">${fmt(ev.amount)}</span>
    </div>`;
  }).join('');

  const total = events.reduce((s, e) => s + (Number(e.amount) || 0), 0);

  document.body.insertAdjacentHTML('beforeend', `
    <div id="fin-cal-popup" class="fin-cal-popup">
      <div class="fin-cal-popup-header">
        <span class="fin-cal-popup-date">${esc(dateLabel)}</span>
        <button class="fin-cal-popup-close" id="fin-cal-popup-close">&times;</button>
      </div>
      <div class="fin-cal-popup-body">${evHtml}</div>
      <div class="fin-cal-popup-footer">Total: <strong>${fmt(total)}</strong></div>
    </div>
  `);

  const popup = document.getElementById('fin-cal-popup');
  if (popup && anchorEl) {
    const popupRect = popup.getBoundingClientRect();
    const anchorRect = anchorEl.getBoundingClientRect();
    const gap = 10;
    const maxLeft = window.innerWidth - popupRect.width - 10;
    const maxTop = window.innerHeight - popupRect.height - 10;

    let left = anchorRect.right + gap;
    let top = anchorRect.top + (anchorRect.height - popupRect.height) / 2;

    if (left > maxLeft) left = anchorRect.left - popupRect.width - gap;
    if (left < 10) left = Math.min(maxLeft, Math.max(10, anchorRect.left + (anchorRect.width - popupRect.width) / 2));
    if (top < 10) top = 10;
    if (top > maxTop) top = Math.max(10, maxTop);

    popup.style.left = `${Math.round(left)}px`;
    popup.style.top = `${Math.round(top)}px`;
    popup.style.transform = 'none';
  }

  document.getElementById('fin-cal-popup-close')?.addEventListener('click', () => document.getElementById('fin-cal-popup')?.remove());

  setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      const popup = document.getElementById('fin-cal-popup');
      if (popup && !popup.contains(e.target)) { popup.remove(); document.removeEventListener('click', handler); }
    });
  }, 10);
}

// ─── Render legend with filter toggles ────────────────────────────────────────

function _renderLegend() {
  const legendEl = document.getElementById('fin-cal-legend');
  if (!legendEl) return;

  const counts = {
    bill: 0,
    subscription: 0,
    loan: 0,
    recurringIncome: 0,
    recurringExpense: 0,
  };

  Object.values(_getEventsForMonth(_calYear, _calMonth)).flat().forEach(ev => {
    const key = _filterKey(ev);
    counts[key] = (counts[key] ?? 0) + 1;
  });

  const items = [
    { key: 'bill',             color: '#ef4444', label: 'Bill' },
    { key: 'subscription',     color: '#8b5cf6', label: 'Subscription' },
    { key: 'loan',             color: '#3b82f6', label: 'Loan EMI' },
    { key: 'recurringIncome',  color: '#10b981', label: 'Recurring Income' },
    { key: 'recurringExpense', color: '#f59e0b', label: 'Recurring Expense' },
  ];

  legendEl.innerHTML = items.map(({ key, color, label }) => {
    const on = _filters[key];
    return `<span class="fin-cal-legend-item${on ? '' : ' fin-cal-legend-off'}" data-filter-key="${key}">
      <span class="fin-cal-legend-dot" style="background:${on ? color : '#94a3b8'}"></span>
      <span>${esc(label)}</span>
      <span class="fin-cal-legend-count">${counts[key] ?? 0}</span>
    </span>`;
  }).join('');

  legendEl.querySelectorAll('.fin-cal-legend-item').forEach(item => {
    item.addEventListener('click', () => {
      const key = item.dataset.filterKey;
      _filters[key] = !_filters[key];
      render();
    });
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────

export function render() {
  const container = document.getElementById('fin-calendar-grid');
  const labelEl   = document.getElementById('cal-month-label');
  const monthPickerEl = document.getElementById('cal-month-picker');
  if (!container) return;

  const monthName = new Date(_calYear, _calMonth, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  if (labelEl) labelEl.textContent = monthName;
  if (monthPickerEl) monthPickerEl.value = `${_calYear}-${String(_calMonth + 1).padStart(2, '0')}`;

  _renderLegend();

  const allMonthEvents = _getEventsForMonth(_calYear, _calMonth);
  const daysInMonth    = new Date(_calYear, _calMonth + 1, 0).getDate();
  const firstDow       = new Date(_calYear, _calMonth, 1).getDay();
  const today          = new Date();
  const todayStr       = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const DAY_NAMES      = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MAX_VISIBLE    = 3;

  let html = `<div class="fin-cal-week-strip">`;

  DAY_NAMES.forEach(d => { html += `<div class="fin-cal-header">${d}</div>`; });

  html += `</div><div class="fin-cal-grid">`;

  for (let i = 0; i < firstDow; i++) {
    html += `<div class="fin-cal-cell fin-cal-empty"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr   = `${_calYear}-${String(_calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday   = dateStr === todayStr;
    const isPast    = dateStr < todayStr;
    const dayEvents = (allMonthEvents[day] ?? []).filter(ev => _filters[_filterKey(ev)]);
    const visible   = dayEvents.slice(0, MAX_VISIBLE);
    const overflow  = dayEvents.length - MAX_VISIBLE;
    const hasEvents = dayEvents.length > 0;

    html += `<div class="fin-cal-cell${isToday ? ' fin-cal-today' : ''}${isPast ? ' fin-cal-past' : ''}${hasEvents ? ' fin-cal-has-events' : ''}" data-day="${day}">
      <div class="fin-cal-day-head">
        <div class="fin-cal-day-num${isToday ? ' fin-cal-day-num-today' : ''}">${day}</div>
        ${hasEvents ? '<span class="fin-cal-day-event-dot"></span>' : ''}
      </div>
      <div class="fin-cal-events">`;

    visible.forEach(ev => {
      const isOverdue = isPast && (ev.type === 'bill' || ev.type === 'subscription');
      const evIcon = _evIcon(ev);
      html += `<div class="fin-cal-event${isOverdue ? ' fin-cal-overdue' : ''}" style="border-left-color:${ev.color}" title="${esc(ev.label)} — ${fmt(ev.amount)}">
        <i class="bi ${evIcon} fin-cal-ev-icon" style="color:${ev.color}"></i>
        <span class="fin-cal-ev-label">${esc(ev.label)}</span>
      </div>`;
    });

    if (overflow > 0) {
      html += `<div class="fin-cal-more">+${overflow} more</div>`;
    }

    html += `</div></div>`;
  }

  const totalCells = firstDow + daysInMonth;
  const remainder  = totalCells % 7;
  if (remainder !== 0) {
    for (let i = 0; i < 7 - remainder; i++) {
      html += `<div class="fin-cal-cell fin-cal-empty"></div>`;
    }
  }

  html += `</div>`;

  // ─── Monthly summary footer ────────────────────────────────────────────────
  const allEvents          = Object.values(allMonthEvents).flat();
  const totalBills         = allEvents.filter(e => e.type === 'bill').reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const totalSubs          = allEvents.filter(e => e.type === 'subscription').reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const totalLoans         = allEvents.filter(e => e.type === 'loan').reduce((s, e) => s + (Number(e.amount) || 0), 0);
  // FIX: separate recurring income and expense totals
  const totalRecurrIncome  = allEvents.filter(e => e.type === 'recurring' && e.subType === 'income').reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const totalRecurrExpense = allEvents.filter(e => e.type === 'recurring' && e.subType !== 'income').reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const totalCommitted     = totalBills + totalSubs + totalLoans + totalRecurrExpense;
  const netCashFlow        = totalRecurrIncome - totalCommitted;
  const netClass           = netCashFlow >= 0 ? 'fin-cal-sum-positive' : 'fin-cal-sum-negative';
  const billCount          = allEvents.filter(e => e.type === 'bill').length;
  const subCount           = allEvents.filter(e => e.type === 'subscription').length;
  const loanCount          = allEvents.filter(e => e.type === 'loan').length;
  const recIncomeCount     = allEvents.filter(e => e.type === 'recurring' && e.subType === 'income').length;
  const recExpenseCount    = allEvents.filter(e => e.type === 'recurring' && e.subType !== 'income').length;

  html += `<div class="fin-cal-summary-cards">
    <div class="fin-cal-stat-card fin-cal-stat-card--bill">
      <div class="fin-cal-stat-top"><i class="bi bi-receipt"></i></div>
      <div class="fin-cal-stat-body">
        <div class="fin-cal-stat-label">Bills</div>
        <div class="fin-cal-stat-value">${fmt(totalBills)}</div>
        <div class="fin-cal-stat-sub">${billCount} items</div>
      </div>
    </div>
    <div class="fin-cal-stat-card fin-cal-stat-card--sub">
      <div class="fin-cal-stat-top"><i class="bi bi-collection-play-fill"></i></div>
      <div class="fin-cal-stat-body">
        <div class="fin-cal-stat-label">Subscriptions</div>
        <div class="fin-cal-stat-value">${fmt(totalSubs)}</div>
        <div class="fin-cal-stat-sub">${subCount} items</div>
      </div>
    </div>
    <div class="fin-cal-stat-card fin-cal-stat-card--loan">
      <div class="fin-cal-stat-top"><i class="bi bi-bank2"></i></div>
      <div class="fin-cal-stat-body">
        <div class="fin-cal-stat-label">Loan EMIs</div>
        <div class="fin-cal-stat-value">${fmt(totalLoans)}</div>
        <div class="fin-cal-stat-sub">${loanCount} items</div>
      </div>
    </div>
    <div class="fin-cal-stat-card fin-cal-stat-card--inc">
      <div class="fin-cal-stat-top"><i class="bi bi-arrow-down-circle-fill"></i></div>
      <div class="fin-cal-stat-body">
        <div class="fin-cal-stat-label">Recurring Income</div>
        <div class="fin-cal-stat-value">${fmt(totalRecurrIncome)}</div>
        <div class="fin-cal-stat-sub">${recIncomeCount} items</div>
      </div>
    </div>
    <div class="fin-cal-stat-card fin-cal-stat-card--exp">
      <div class="fin-cal-stat-top"><i class="bi bi-arrow-repeat"></i></div>
      <div class="fin-cal-stat-body">
        <div class="fin-cal-stat-label">Recurring Expense</div>
        <div class="fin-cal-stat-value">${fmt(totalRecurrExpense)}</div>
        <div class="fin-cal-stat-sub">${recExpenseCount} items</div>
      </div>
    </div>
    <div class="fin-cal-stat-card fin-cal-stat-card-accent ${netClass}">
      <div class="fin-cal-stat-top"><i class="bi bi-activity"></i></div>
      <div class="fin-cal-stat-body">
        <div class="fin-cal-stat-label">Net Cash Flow</div>
        <div class="fin-cal-stat-value">${fmt(netCashFlow)}</div>
        <div class="fin-cal-stat-sub">Committed: ${fmt(totalCommitted)}</div>
      </div>
    </div>
  </div>`;

  // ─── Upcoming events panel (next 14 days) ─────────────────────────────────
  const upcoming = _getUpcomingEvents(14);
  if (upcoming.length > 0) {
    const typeMap = { bill: 'Bill', subscription: 'Subscription', loan: 'Loan EMI' };
    html += `<div class="fin-cal-upcoming">
      <div class="fin-cal-upcoming-title"><i class="bi bi-clock-history"></i> Upcoming — Next 14 Days</div>`;
    const grouped = new Map();
    upcoming.forEach(ev => {
      const key = `${ev.date.getFullYear()}-${String(ev.date.getMonth() + 1).padStart(2, '0')}-${String(ev.date.getDate()).padStart(2, '0')}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(ev);
    });

    grouped.forEach(dayEvents => {
      const refDate = dayEvents[0].date;
      const dateLabel = refDate.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
      const dayDelta = _daysFromToday(refDate);
      const relative = dayDelta === 0 ? 'Today' : dayDelta === 1 ? 'Tomorrow' : `in ${dayDelta} days`;

      html += `<div class="fin-cal-upcoming-group">
        <div class="fin-cal-upcoming-group-head">
          <span>${esc(dateLabel)}</span>
          <span class="fin-cal-upcoming-relative">${esc(relative)}</span>
        </div>`;

      dayEvents.forEach(ev => {
      const typeLabel = ev.type === 'recurring' ? (ev.subType === 'income' ? 'Income' : 'Expense') : (typeMap[ev.type] ?? ev.type);
      const evIcon = _evIcon(ev);
      html += `<div class="fin-cal-upcoming-row">
        <i class="bi ${evIcon} fin-cal-upcoming-icon" style="color:${ev.color}"></i>
        <span class="fin-cal-upcoming-label">${esc(ev.label)}</span>
        <span class="fin-cal-upcoming-type">${esc(typeLabel)}</span>
        <span class="fin-cal-upcoming-amt">${fmt(ev.amount)}</span>
      </div>`;
      });

      html += `</div>`;
    });
    html += `</div>`;
  }

  container.innerHTML = html;

  // ─── Day cell click → popup ────────────────────────────────────────────────
  container.querySelectorAll('.fin-cal-cell.fin-cal-has-events').forEach(cell => {
    cell.addEventListener('click', () => {
      const day       = Number(cell.dataset.day);
      const dayEvents = (allMonthEvents[day] ?? []).filter(ev => _filters[_filterKey(ev)]);
      if (dayEvents.length > 0) _showDayPopup(day, _calYear, _calMonth, dayEvents, cell);
    });
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function init() {
  document.getElementById('cal-month-picker')?.addEventListener('change', e => {
    const [y, m] = String(e.target.value || '').split('-').map(Number);
    if (!y || !m) return;
    _calYear = y;
    _calMonth = m - 1;
    render();
  });

  document.getElementById('cal-prev')?.addEventListener('click', () => {
    _calMonth--;
    if (_calMonth < 0) { _calMonth = 11; _calYear--; }
    render();
  });
  document.getElementById('cal-next')?.addEventListener('click', () => {
    _calMonth++;
    if (_calMonth > 11) { _calMonth = 0; _calYear++; }
    render();
  });
  document.getElementById('cal-today')?.addEventListener('click', () => {
    const now = new Date();
    _calYear  = now.getFullYear();
    _calMonth = now.getMonth();
    render();
  });

  const storeKeys = ['bills', 'subscriptions', 'loans', 'recurring'];
  storeKeys.forEach(k => store.on(k, () => render()));
}
