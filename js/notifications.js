// js/notifications.js — Notification / Alert System

import * as store from './store.js';

const _notifications = [];
const _alertedBudgets = new Set(); // tracks 'id:threshold' shown this session
let _budgetToastTimer = null;

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function addNotification(type, message, icon = 'bi-bell') {
  _notifications.unshift({ type, message, icon, time: new Date() });
  _renderPanel();
  _updateBadge();
}

function _renderPanel() {
  const list = document.getElementById('notif-list');
  if (!list) return;
  if (_notifications.length === 0) {
    list.innerHTML = '<div class="notif-empty">No notifications</div>';
    return;
  }
  list.innerHTML = _notifications.map((n, i) => `
    <div class="notif-item notif-item--${escapeHtml(n.type)}">
      <i class="bi ${escapeHtml(n.icon)} notif-item-icon"></i>
      <span class="notif-item-msg">${escapeHtml(n.message)}</span>
    </div>`).join('');
}

function _updateBadge() {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  const count = _notifications.length;
  badge.textContent = count > 9 ? '9+' : String(count);
  badge.classList.toggle('d-none', count === 0);
}

export function refreshNotifications() {
  _notifications.length = 0;

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  // 1. Overdue maintenance
  const maintenance = store.get('maintenance') ?? [];
  const manualOdo = store.get('manualOdo') ?? {};
  const tripOdo = {};
  (store.get('tripLogs') ?? []).forEach(l => {
    if (!tripOdo[l.vehicleName] || l.odoReading > tripOdo[l.vehicleName])
      tripOdo[l.vehicleName] = l.odoReading;
  });
  const latestMap = {};
  maintenance.forEach(r => { latestMap[`${r.vehicleName}__${r.type}`] = r; });
  Object.values(latestMap).forEach(r => {
    const curOdo = manualOdo[r.vehicleName] ?? tripOdo[r.vehicleName] ?? r.odoReading;
    const nextKm = r.intervalKm > 0 ? r.odoReading + r.intervalKm : null;
    const doneDate = new Date(r.date);
    const nextDate = r.intervalDays > 0 ? new Date(doneDate.getTime() + r.intervalDays * 86400000) : null;
    const kmLeft = nextKm ? nextKm - curOdo : null;
    const daysLeft = nextDate ? Math.round((nextDate - now) / 86400000) : null;
    if ((kmLeft !== null && kmLeft <= 0) || (daysLeft !== null && daysLeft <= 0)) {
      _notifications.push({ type: 'warning', message: `Maintenance overdue: ${r.type} for ${r.vehicleName}`, icon: 'bi-tools', time: now });
    }
  });

  // 2. Budget exceeded / approaching
  const budgets = store.get('budgets') ?? [];
  const expenses = store.get('expenses') ?? [];
  const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  budgets.filter(b => b.month === curYM).forEach(b => {
    const spent = expenses.filter(e => e.category === b.category && String(e.date ?? '').startsWith(b.month)).reduce((s, e) => s + e.amount, 0);
    const pct = b.monthlyLimit > 0 ? (spent / b.monthlyLimit) * 100 : 0;
    if (spent > b.monthlyLimit) {
      _notifications.push({ type: 'danger', message: `Budget exceeded: ${b.category} (₹${Math.round(spent)} / ₹${b.monthlyLimit})`, icon: 'bi-exclamation-triangle-fill', time: now });
    } else if (pct >= 80) {
      _notifications.push({ type: 'warning', message: `Budget at ${pct.toFixed(0)}%: ${b.category} (₹${Math.round(spent)} of ₹${b.monthlyLimit})`, icon: 'bi-exclamation-circle-fill', time: now });
    }
  });

  // 3. Lending due (outstanding lendings older than 30 days)
  const lendings = store.get('lendings') ?? [];
  const settlements = store.get('lendingSettlements') ?? [];
  lendings.forEach(l => {
    if (!l.date) return;
    const settled = settlements.filter(s => s.entryId === l.id).reduce((s, x) => s + x.amount, 0);
    const outstanding = Math.max(l.amount - settled, 0);
    if (outstanding <= 0) return;
    const daysOld = Math.round((now - new Date(l.date)) / 86400000);
    if (daysOld >= 30) {
      _notifications.push({ type: 'info', message: `Lending to ${l.counterparty} outstanding for ${daysOld} days (₹${Math.round(outstanding)})`, icon: 'bi-people-fill', time: now });
    }
  });

  // 4. Savings goal deadline approaching (within 7 days)
  const savings = store.get('savings') ?? [];
  savings.forEach(g => {
    if (!g.targetDate) return;
    const daysLeft = Math.round((new Date(g.targetDate) - now) / 86400000);
    if (daysLeft >= 0 && daysLeft <= 7 && g.savedAmount < g.targetAmount) {
      _notifications.push({ type: 'warning', message: `Savings goal "${g.name}" deadline in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`, icon: 'bi-piggy-bank-fill', time: now });
    }
  });

  // 5. CC payment due within 7 days
  const creditCards = store.get('creditCards') ?? [];
  creditCards.filter(c => c.dueDay).forEach(c => {
    const today = now.getDate();
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const effectiveDue = Math.min(c.dueDay, daysInMonth);
    let daysUntil;
    if (effectiveDue >= today) {
      daysUntil = effectiveDue - today;
    } else {
      const nextMonth = month === 11 ? 0 : month + 1;
      const nextYear = month === 11 ? year + 1 : year;
      const daysInNext = new Date(nextYear, nextMonth + 1, 0).getDate();
      daysUntil = daysInMonth - today + Math.min(c.dueDay, daysInNext);
    }
    if (daysUntil <= 7) {
      _notifications.push({ type: 'warning', message: `CC payment due in ${daysUntil} day${daysUntil === 1 ? '' : 's'}: ${c.name}`, icon: 'bi-credit-card-fill', time: now });
    }
  });

  _renderPanel();
  _updateBadge();
}

// ─── Proactive budget alert toasts ──────────────────────────────────────────

export function checkBudgetAlerts() {
  const now = new Date();
  const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const budgets = store.get('budgets') ?? [];
  const expenses = store.get('expenses') ?? [];

  budgets.filter(b => b.month === curYM).forEach(b => {
    const spent = expenses
      .filter(e => e.category === b.category && String(e.date ?? '').startsWith(b.month))
      .reduce((s, e) => s + e.amount, 0);
    const pct = b.monthlyLimit > 0 ? (spent / b.monthlyLimit) * 100 : 0;

    if (pct >= 100 && !_alertedBudgets.has(`${b.id}:100`)) {
      _alertedBudgets.add(`${b.id}:100`);
      _alertedBudgets.delete(`${b.id}:80`);
      _showBudgetToast(
        `⚠️ Budget exceeded! ${b.category}: ₹${Math.round(spent)} / ₹${b.monthlyLimit}`,
        'danger'
      );
    } else if (pct >= 80 && !_alertedBudgets.has(`${b.id}:80`) && !_alertedBudgets.has(`${b.id}:100`)) {
      _alertedBudgets.add(`${b.id}:80`);
      _showBudgetToast(
        `Budget at ${pct.toFixed(0)}%: ${b.category} — ₹${Math.round(spent)} of ₹${b.monthlyLimit}`,
        'warning'
      );
    }
  });
}

function _showBudgetToast(message, type) {
  const toast = document.getElementById('budget-alert-toast');
  const msgEl = document.getElementById('budget-alert-toast-msg');
  const closeBtn = document.getElementById('budget-alert-toast-close');
  if (!toast || !msgEl) return;

  msgEl.textContent = message;
  toast.className = `budget-alert-toast budget-alert-toast--${type}`;

  const hide = () => { toast.classList.add('d-none'); };
  if (closeBtn) {
    const newClose = closeBtn.cloneNode(true);
    closeBtn.parentNode.replaceChild(newClose, closeBtn);
    document.getElementById('budget-alert-toast-close').addEventListener('click', hide);
  }

  if (_budgetToastTimer) clearTimeout(_budgetToastTimer);
  _budgetToastTimer = setTimeout(hide, 7000);
}

export function initNotifications() {
  const btn = document.getElementById('notif-btn');
  const panel = document.getElementById('notif-panel');
  const clearBtn = document.getElementById('notif-clear');

  if (btn && panel) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.toggle('d-none');
    });
    document.addEventListener('click', (e) => {
      const wrap = document.getElementById('notif-wrap');
      if (wrap && !wrap.contains(e.target)) {
        panel.classList.add('d-none');
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      _notifications.length = 0;
      _renderPanel();
      _updateBadge();
    });
  }

  _renderPanel();
  _updateBadge();
}
