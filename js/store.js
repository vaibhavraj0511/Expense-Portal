// js/store.js — In-memory store + event bus
// Requirements: 2.1, 7.1

const state = {
  expenses: [],
  income: [],
  accounts: [],
  creditCards: [],
  budgets: [],
  savings: [],
  transfers: [],
  tripLogs: [],
  vehicleExpenses: [],
  expenseCategories: [],
  incomeSources: [],
  subCategories: [],
  vehicles: [],
  vehicleExpenseTypes: [],
  ccPayments: [],
  lendings: [],
  lendingSettlements: [],
  vehicleInsurance: [],
  splitGroups: [],
  loans: [],
};

const listeners = {};

function set(key, records) {
  state[key] = records;
  if (listeners[key]) {
    listeners[key].forEach(cb => cb(records));
  }
}

function get(key) {
  return state[key];
}

function on(key, callback) {
  if (!listeners[key]) listeners[key] = [];
  listeners[key].push(callback);
}

function off(key, callback) {
  if (!listeners[key]) return;
  listeners[key] = listeners[key].filter(cb => cb !== callback);
}

export { set, get, on, off };
