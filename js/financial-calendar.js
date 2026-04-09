// js/financial-calendar.js — Financial Calendar view

import * as store from './store.js';
import { calcEmi } from './loans.js';

let _calYear  = new Date().getFullYear();
let _calMonth = new Date().getMonth(); // 0-indexed

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(n) {
  return '₹' + Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
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

  // 2. Subscriptions
  const subs = store.get('subscriptions') ?? [];
  subs.filter(s => s.active !== false && s.nextBillingDate).forEach(s => {
    const next = new Date(s.nextBillingDate + 'T00:00:00');
    if (isNaN(next)) return;
    const nextYear  = next.getFullYear();
    const nextMonth = next.getMonth();
    const nextDay   = next.getDate();
    // Show in calendar month if it falls in this month or if billing cycle causes it to
    if (nextYear === year && nextMonth === month) {
      addEvent(nextDay, { type: 'subscription', label: s.name, amount: s.amount, icon: 'bi-collection-play-fill', color: '#8b5cf6' });
    } else if (s.billingCycle === 'monthly') {
      addEvent(nextDay, { type: 'subscription', label: s.name, amount: s.amount, icon: 'bi-collection-play-fill', color: '#8b5cf6' });
    }
  });

  // 3. Loan EMIs — derive day from startDate, amount from calcEmi
  const loans = store.get('loans') ?? [];
  loans.filter(l => l.status === 'active' && l.startDate).forEach(l => {
    const startDay = new Date(l.startDate + 'T00:00:00').getDate();
    if (!startDay) return;
    const emiAmt = calcEmi(l.principal, l.interestRate, l.tenureMonths);
    addEvent(startDay, { type: 'loan', label: l.name || l.loanType || 'Loan EMI', amount: Math.round(emiAmt), icon: 'bi-bank2', color: '#3b82f6' });
  });

  // 4. Recurring (expense/income)
  const recurring = store.get('recurring') ?? [];
  recurring.filter(r => !r.paused).forEach(r => {
    if (r.frequency === 'monthly' && r.day) {
      const recurColor = r.type === 'income' ? '#10b981' : '#f59e0b';
      addEvent(Number(r.day), { type: 'recurring', label: r.description || r.category, amount: r.amount, icon: r.type === 'income' ? 'bi-arrow-down-circle-fill' : 'bi-arrow-repeat', color: recurColor });
    } else if (r.frequency === 'weekly' && r.day !== undefined) {
      // Find all Sundays+r.day in the month
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        const dow = new Date(year, month, d).getDay();
        if (dow === Number(r.day)) {
          const wColor = r.type === 'income' ? '#10b981' : '#f59e0b';
          addEvent(d, { type: 'recurring', label: r.description || r.category, amount: r.amount, icon: 'bi-arrow-repeat', color: wColor });
        }
      }
    } else if (r.frequency === 'yearly' && r.day) {
      const recMonth = r.month ? Number(r.month) - 1 : 0;
      if (recMonth === month) {
        const yColor = r.type === 'income' ? '#10b981' : '#f59e0b';
        addEvent(Number(r.day), { type: 'recurring', label: r.description || r.category, amount: r.amount, icon: 'bi-arrow-repeat', color: yColor });
      }
    }
  });

  return events;
}

// ─── Render ───────────────────────────────────────────────────────────────────

export function render() {
  const container = document.getElementById('fin-calendar-grid');
  const labelEl   = document.getElementById('cal-month-label');
  if (!container) return;

  const monthName = new Date(_calYear, _calMonth, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  if (labelEl) labelEl.textContent = monthName;

  const events      = _getEventsForMonth(_calYear, _calMonth);
  const daysInMonth = new Date(_calYear, _calMonth + 1, 0).getDate();
  const firstDow    = new Date(_calYear, _calMonth, 1).getDay(); // 0=Sun
  const today       = new Date();
  const todayStr    = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  let html = `<div class="fin-cal-grid">`;

  // Header row
  DAY_NAMES.forEach(d => {
    html += `<div class="fin-cal-header">${d}</div>`;
  });

  // Empty cells before month start
  for (let i = 0; i < firstDow; i++) {
    html += `<div class="fin-cal-cell fin-cal-empty"></div>`;
  }

  // Day cells
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${_calYear}-${String(_calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday = dateStr === todayStr;
    const dayEvents = events[day] ?? [];
    const isPast = dateStr < todayStr;

    html += `<div class="fin-cal-cell${isToday ? ' fin-cal-today' : ''}${isPast ? ' fin-cal-past' : ''}">
      <div class="fin-cal-day-num">${day}</div>
      <div class="fin-cal-events">`;

    dayEvents.forEach(ev => {
      html += `<div class="fin-cal-event" style="border-left-color:${ev.color}" title="${esc(ev.label)} — ${fmt(ev.amount)}">
        <span class="fin-cal-ev-dot" style="background:${ev.color}"></span>
        <span class="fin-cal-ev-label">${esc(ev.label)}</span>
        <span class="fin-cal-ev-amt">${fmt(ev.amount)}</span>
      </div>`;
    });

    html += `</div></div>`;
  }

  // Trailing empty cells to complete last row
  const totalCells = firstDow + daysInMonth;
  const remainder  = totalCells % 7;
  if (remainder !== 0) {
    for (let i = 0; i < 7 - remainder; i++) {
      html += `<div class="fin-cal-cell fin-cal-empty"></div>`;
    }
  }

  html += `</div>`;

  // Monthly summary footer
  const allEvents = Object.values(events).flat();
  const totalBills   = allEvents.filter(e => e.type === 'bill').reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const totalSubs    = allEvents.filter(e => e.type === 'subscription').reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const totalLoans   = allEvents.filter(e => e.type === 'loan').reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const totalRecurr  = allEvents.filter(e => e.type === 'recurring').reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const grandTotal   = totalBills + totalSubs + totalLoans + totalRecurr;

  html += `<div class="fin-cal-summary">
    <div class="fin-cal-sum-item"><span class="fin-cal-sum-dot" style="background:#ef4444"></span><span>Bills</span><strong>${fmt(totalBills)}</strong></div>
    <div class="fin-cal-sum-item"><span class="fin-cal-sum-dot" style="background:#8b5cf6"></span><span>Subscriptions</span><strong>${fmt(totalSubs)}</strong></div>
    <div class="fin-cal-sum-item"><span class="fin-cal-sum-dot" style="background:#3b82f6"></span><span>Loan EMIs</span><strong>${fmt(totalLoans)}</strong></div>
    <div class="fin-cal-sum-item"><span class="fin-cal-sum-dot" style="background:#10b981"></span><span>Recurring</span><strong>${fmt(totalRecurr)}</strong></div>
    <div class="fin-cal-sum-item fin-cal-sum-total"><span>Total Committed</span><strong>${fmt(grandTotal)}</strong></div>
  </div>`;

  container.innerHTML = html;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function init() {
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
  storeKeys.forEach(k => store.on(k, render));
}
