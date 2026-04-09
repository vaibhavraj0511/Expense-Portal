// js/utils.js — Date/currency formatting and month helpers
// Requirements: 4.1, 9.1, 9.2, 9.3

/**
 * Formats a YYYY-MM-DD string to a readable locale date string.
 * @param {string} dateStr
 * @returns {string}
 */
function formatDate(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Formats a number as Indian Rupee (₹) with 2 decimal places.
 * @param {number} amount
 * @returns {string}
 */
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Returns the current month as a YYYY-MM string.
 * @returns {string}
 */
function getCurrentMonth() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Returns true if `dateStr` falls in the current calendar month.
 * @param {string} dateStr  YYYY-MM-DD
 * @returns {boolean}
 */
function isInCurrentMonth(dateStr) {
  return isInMonth(dateStr, getCurrentMonth());
}

/**
 * Returns true if `dateStr` falls in the given YYYY-MM month.
 * @param {string} dateStr    YYYY-MM-DD
 * @param {string} yearMonth  YYYY-MM
 * @returns {boolean}
 */
function isInMonth(dateStr, yearMonth) {
  return typeof dateStr === 'string' && dateStr.startsWith(yearMonth);
}

/**
 * Returns an array of the last 6 YYYY-MM strings in chronological order.
 * @returns {string[]}
 */
function getLast6Months() {
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    months.push(`${year}-${month}`);
  }
  return months;
}

export { formatDate, formatCurrency, getCurrentMonth, isInCurrentMonth, isInMonth, getLast6Months };

/**
 * Wires up a dependent payment method pair:
 * typeSelect → picks "account" or "card"
 * valueSelect → shows only matching items from store
 * Returns a refresh function to call when accounts/cards change.
 */
export function bindDependentPaymentSelect(typeSelectId, valueSelectId, storeRef) {
  const typeSel  = document.getElementById(typeSelectId);
  const valueSel = document.getElementById(valueSelectId);
  if (!typeSel || !valueSel) return () => {};

  function refresh() {
    const type = typeSel.value;
    const accounts    = storeRef.get('accounts')    ?? [];
    const creditCards = storeRef.get('creditCards') ?? [];
    const cur = valueSel.value;

    let items = [];
    if (type === 'account') items = accounts.filter(a => !['Wallet','Cash'].includes(a.type)).map(a => a.name);
    else if (type === 'wallet') items = accounts.filter(a => a.type === 'Wallet').map(a => a.name);
    else if (type === 'cash')   items = accounts.filter(a => a.type === 'Cash').map(a => a.name);
    else if (type === 'card')   items = creditCards.map(c => c.name);

    valueSel.innerHTML = `<option value="">Select…</option>` +
      items.map(n => `<option value="${n}">${n}</option>`).join('');
    valueSel.disabled = !type;
    if (cur && items.includes(cur)) valueSel.value = cur;
  }

  typeSel.addEventListener('change', refresh);
  refresh();
  return refresh;
}

/**
 * Restores the type+value selects when editing an existing record.
 * Figures out whether the saved value is an account or credit card.
 */
export function restorePaymentSelects(typeSelectId, valueSelectId, savedValue, storeRef) {
  if (!savedValue) return;
  const accounts    = storeRef.get('accounts')    ?? [];
  const creditCards = storeRef.get('creditCards') ?? [];
  const typeSel  = document.getElementById(typeSelectId);
  const valueSel = document.getElementById(valueSelectId);
  if (!typeSel || !valueSel) return;

  const isWallet  = accounts.some(a => a.name === savedValue && a.type === 'Wallet');
  const isCash    = accounts.some(a => a.name === savedValue && a.type === 'Cash');
  const isAccount = accounts.some(a => a.name === savedValue && !['Wallet','Cash'].includes(a.type));
  typeSel.value = isWallet ? 'wallet' : isCash ? 'cash' : isAccount ? 'account' : 'card';
  typeSel.dispatchEvent(new Event('change'));
  setTimeout(() => { valueSel.value = savedValue; }, 0);
}

export function populatePaymentSelect(sel, accounts, creditCards, placeholder = 'Select payment method…') {
  if (!sel) return;
  const cur = sel.value;
  let html = `<option value="">${placeholder}</option>`;
  const bankAccounts = accounts.filter(a => !['Wallet','Cash'].includes(a.type));
  const wallets      = accounts.filter(a => a.type === 'Wallet');
  const cashAccounts = accounts.filter(a => a.type === 'Cash');
  if (bankAccounts.length) {
    html += `<optgroup label="Bank Accounts">` +
      bankAccounts.map(a => `<option value="${a.name}">${a.name}</option>`).join('') +
      `</optgroup>`;
  }
  if (wallets.length) {
    html += `<optgroup label="Wallets">` +
      wallets.map(a => `<option value="${a.name}">${a.name}</option>`).join('') +
      `</optgroup>`;
  }
  if (cashAccounts.length) {
    html += `<optgroup label="Cash">` +
      cashAccounts.map(a => `<option value="${a.name}">${a.name}</option>`).join('') +
      `</optgroup>`;
  }
  if (creditCards.length) {
    html += `<optgroup label="Credit Cards">` +
      creditCards.map(c => `<option value="${c.name}">${c.name}</option>`).join('') +
      `</optgroup>`;
  }
  sel.innerHTML = html;
  if (cur) sel.value = cur;
}
