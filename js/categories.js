// js/categories.js — Manage expense categories and income sources
import { CONFIG } from './config.js';
import { appendRow, fetchRows, writeAllRows } from './api.js';
import * as store from './store.js';
import { epConfirm } from './confirm.js';

// ─── Suggested category map ──────────────────────────────────────────────────
export const CATEGORY_SUGGESTIONS = {
  'Food':          ['Groceries', 'Restaurants', 'Fast Food', 'Coffee', 'Snacks', 'Beverages', 'Swiggy / Zomato', 'Home Cooking', 'Fruits & Vegetables'],
  'Travel':        ['Fuel', 'Taxi / Auto', 'Bus / Train', 'Flight', 'Hotel', 'Toll', 'Parking', 'Metro', 'Cab Booking'],
  'Utilities':     ['Electricity', 'Water', 'Gas', 'Internet', 'Mobile Recharge', 'DTH / Cable', 'Broadband', 'Piped Gas'],
  'Shopping':      ['Clothes', 'Electronics', 'Amazon / Flipkart', 'Home Decor', 'Books', 'Accessories', 'Shoes', 'Furniture'],
  'Health':        ['Medicine', 'Doctor Visit', 'Hospital', 'Lab Tests', 'Health Insurance', 'Gym', 'Pharmacy', 'Dental'],
  'Entertainment': ['Movies', 'OTT Subscriptions', 'Gaming', 'Sports', 'Concerts', 'Music', 'Streaming'],
  'Education':     ['Tuition', 'Books', 'Online Courses', 'School Fees', 'Stationery', 'Coaching', 'Exam Fees'],
  'Household':     ['House Rent', 'Maintenance', 'Repairs', 'Maid Salary', 'Cook Salary', 'Society Charges', 'Cleaning'],
  'Personal Care': ['Haircut', 'Salon', 'Spa', 'Skincare', 'Cosmetics', 'Grooming'],
  'Kids':          ['School Fees', 'Toys', 'Clothes', 'Tuition', 'Extracurricular', 'Stationery'],
  'Vehicle':       ['Fuel', 'Service', 'Insurance', 'Parking', 'Toll', 'Tyres', 'Car Wash', 'Accessories'],
  'EMI / Loans':   ['Home Loan EMI', 'Car Loan EMI', 'Personal Loan EMI', 'Education Loan EMI', 'Credit Card EMI'],
  'Investments':   ['Mutual Funds', 'Stocks', 'Fixed Deposit', 'PPF', 'Gold', 'NPS', 'Real Estate'],
  'Recharge':      ['Mobile', 'DTH', 'Data Pack', 'Electricity Prepaid'],
  'Other':         ['Miscellaneous', 'Gifts', 'Donations', 'Bank Charges', 'Subscriptions'],
};

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Food', 'Travel', 'Utilities', 'Shopping', 'Health', 'Entertainment', 'Education', 'Other',
];
export const DEFAULT_INCOME_SOURCES = [
  'Salary', 'Freelance', 'Investment', 'Business', 'Gift', 'Other',
];
export const DEFAULT_VEHICLE_EXPENSE_TYPES = [
  'Fuel Fill-up', 'Maintenance', 'Insurance', 'Tyre Change', 'Other',
];

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _norm(value) {
  return String(value ?? '').trim().toLowerCase();
}

// ─── Public getters ───────────────────────────────────────────────────────────

export function getExpenseCategories() {
  const custom = store.get('expenseCategories') ?? [];
  return custom.length > 0 ? custom.map(r => r.name) : DEFAULT_EXPENSE_CATEGORIES;
}

export function getIncomeSources() {
  const custom = store.get('incomeSources') ?? [];
  return custom.length > 0 ? custom.map(r => r.name) : DEFAULT_INCOME_SOURCES;
}

export function getVehicleExpenseTypes() {
  const custom = store.get('vehicleExpenseTypes') ?? [];
  return custom.length > 0 ? custom.map(r => r.name) : DEFAULT_VEHICLE_EXPENSE_TYPES;
}

// ─── Dropdown helpers ─────────────────────────────────────────────────────────

export function populateSelect(selectId, options, placeholder) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">${placeholder}</option>` +
    options.map(o => `<option value="${escapeHtml(o)}"${o === current ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('');
}

export function populateMultiSelect(selectId, options) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const selected = new Set(Array.from(select.selectedOptions).map(o => o.value));
  select.innerHTML = options.map(o =>
    `<option value="${escapeHtml(o)}"${selected.has(o) ? ' selected' : ''}>${escapeHtml(o)}</option>`
  ).join('');
}

export function refreshCategoryDropdowns() {
  const cats = getExpenseCategories().slice().sort((a, b) => a.localeCompare(b));
  populateSelect('expense-category', cats, 'Select category…');
  populateMultiSelect('expense-category-filter', cats);

  const veTypes = getVehicleExpenseTypes().slice().sort((a, b) => a.localeCompare(b));
  populateSelect('ve-type', veTypes, 'Select type…');

  // Budget category = expense categories + vehicle expense types, deduplicated & sorted
  const budgetCats = [...new Set([...cats, ...veTypes])].sort((a, b) => a.localeCompare(b));
  populateSelect('budget-category', budgetCats, 'Select category…');

  const sources = getIncomeSources().slice().sort((a, b) => a.localeCompare(b));
  populateSelect('income-source', sources, 'Select source…');
  populateMultiSelect('income-source-filter', sources);
}

// ─── render() ────────────────────────────────────────────────────────────────

export function render() {
  _renderList(
    'expense-categories-list',
    store.get('expenseCategories') ?? [],
    DEFAULT_EXPENSE_CATEGORIES,
    'expenseCategories',
    CONFIG.sheets.expenseCategories,
    'cat-tag-expense'
  );
  _renderList(
    'income-sources-list',
    store.get('incomeSources') ?? [],
    DEFAULT_INCOME_SOURCES,
    'incomeSources',
    CONFIG.sheets.incomeSources,
    'cat-tag-income'
  );
  _renderList(
    'vehicle-expense-types-list',
    store.get('vehicleExpenseTypes') ?? [],
    DEFAULT_VEHICLE_EXPENSE_TYPES,
    'vehicleExpenseTypes',
    CONFIG.sheets.vehicleExpenseTypes,
    'cat-tag-vehicle'
  );
  _renderSubCategories();
  _renderSuggestions();
  _renderSmartExpenseSuggestions();
  refreshCategoryDropdowns();
  _updateTabCounts();
}

const CAT_VISIBLE = 10;

function _renderList(containerId, records, defaults, storeKey, sheetName, chipClass = '') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const hasCustom = records.length > 0;
  const items = (hasCustom ? records.map(r => r.name) : defaults).slice().sort((a, b) => a.localeCompare(b));
  const expanded = container._catExpanded ?? false;
  const visible = expanded ? items : items.slice(0, CAT_VISIBLE);
  const hiddenCount = items.length - CAT_VISIBLE;

  function makeTag(name) {
    return `<span class="cat-tag${chipClass ? ' ' + chipClass : ''}${hasCustom ? ' cat-tag-deletable' : ''}">
      ${escapeHtml(name)}
      ${hasCustom ? `<button type="button" class="cat-tag-rename" aria-label="Rename ${escapeHtml(name)}" data-rename-name="${escapeHtml(name)}" data-store-key="${storeKey}" data-sheet="${sheetName}" title="Rename"><i class="bi bi-pencil-fill"></i></button>` : ''}
      ${hasCustom ? `<button type="button" class="cat-tag-del" aria-label="Delete ${escapeHtml(name)}" data-delete-name="${escapeHtml(name)}" data-store-key="${storeKey}" data-sheet="${sheetName}"><i class="bi bi-x"></i></button>` : ''}
    </span>`;
  }

  container.innerHTML = visible.map(makeTag).join('') +
    (!expanded && hiddenCount > 0
      ? `<button type="button" class="cat-tag cat-tag-more">+${hiddenCount} more</button>`
      : expanded && items.length > CAT_VISIBLE
        ? `<button type="button" class="cat-tag cat-tag-more">Show less</button>`
        : '') +
    (!hasCustom ? `<div class="cat-defaults-notice"><i class="bi bi-info-circle me-1"></i>Using built-in defaults · Add above to customize</div>` : '');

  container.querySelectorAll('[data-rename-name]').forEach(btn => {
    btn.addEventListener('click', () => _handleRename(
      btn.dataset.renameName,
      btn.dataset.storeKey,
      btn.dataset.sheet
    ));
  });

  container.querySelectorAll('[data-delete-name]').forEach(btn => {
    btn.addEventListener('click', () => _handleDelete(
      btn.dataset.deleteName,
      btn.dataset.storeKey,
      btn.dataset.sheet
    ));
  });

  const moreBtn = container.querySelector('.cat-tag-more');
  if (moreBtn) {
    moreBtn.addEventListener('click', () => {
      container._catExpanded = !expanded;
      _renderList(containerId, records, defaults, storeKey, sheetName);
    });
  }
}

async function _handleDelete(name, storeKey, sheetName) {
  if (!await epConfirm(
    `Delete "${name}"? Existing records using this will not be updated.`,
    'Delete Category',
    'Delete'
  )) return;

  const records = store.get(storeKey) ?? [];
  const updated = records.filter(r => r.name !== name);

  try {
    await writeAllRows(sheetName, updated.map(r => [r.name]));
    store.set(storeKey, updated);
  } catch (err) {
    alert(err.message ?? 'Failed to delete. Please try again.');
  }
}

async function _handleRename(oldName, storeKey, sheetName) {
  const newName = await _promptRename(oldName);
  if (!newName || newName === oldName) return;
  const normNew = _norm(newName);

  const existing = store.get(storeKey) ?? [];
  if (existing.some(r => _norm(r.name) === normNew)) {
    alert(`"${newName}" already exists.`);
    return;
  }

  const updated = existing.map(r => r.name === oldName ? { ...r, name: newName } : r);
  try {
    await writeAllRows(sheetName, updated.map(r => [r.name]));
    store.set(storeKey, updated);
    if (storeKey === 'expenseCategories')  await _propagateExpenseCategoryRename(oldName, newName);
    else if (storeKey === 'incomeSources')       await _propagateIncomeSourceRename(oldName, newName);
    else if (storeKey === 'vehicleExpenseTypes')  await _propagateVehicleExpenseTypeRename(oldName, newName);
  } catch (err) {
    alert(err.message ?? 'Failed to rename. Please try again.');
  }
}

function _promptRename(currentName) {
  return new Promise(resolve => {
    const modalEl = document.getElementById('cat-rename-modal');
    if (!modalEl) { resolve(window.prompt('New name:', currentName) ?? null); return; }
    const input    = document.getElementById('cat-rename-input');
    const okBtn    = document.getElementById('cat-rename-ok');
    const cancelBtn = document.getElementById('cat-rename-cancel');
    if (input) input.value = currentName;
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    function cleanup() {
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      input?.removeEventListener('keydown', onKeydown);
      modalEl.removeEventListener('hidden.bs.modal', onCancel);
    }
    function onOk() { const val = input?.value?.trim() ?? ''; cleanup(); modal.hide(); resolve(val || null); }
    function onCancel() { cleanup(); resolve(null); }
    function onKeydown(e) { if (e.key === 'Enter') { e.preventDefault(); onOk(); } }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    input?.addEventListener('keydown', onKeydown);
    modalEl.addEventListener('hidden.bs.modal', onCancel, { once: true });
    modal.show();
    setTimeout(() => input?.select(), 300);
  });
}

async function _propagateExpenseCategoryRename(oldName, newName) {
  const expenses = store.get('expenses') ?? [];
  const updatedExp = expenses.map(e => e.category === oldName ? { ...e, category: newName } : e);
  if (updatedExp.some((e, i) => e.category !== expenses[i].category)) {
    await writeAllRows(CONFIG.sheets.expenses, updatedExp.map(e =>
      [e.date, e.category, e.subCategory ?? '', String(e.amount), e.description, e.paymentMethod]
    ));
    store.set('expenses', updatedExp);
  }
  const budgets = store.get('budgets') ?? [];
  const updatedBudgets = budgets.map(b => b.category === oldName ? { ...b, category: newName } : b);
  if (updatedBudgets.some((b, i) => b.category !== budgets[i].category)) {
    await writeAllRows(CONFIG.sheets.budgets, updatedBudgets.map(b =>
      [b.id, b.category, String(b.monthlyLimit), b.month]
    ));
    store.set('budgets', updatedBudgets);
  }
  const subs = store.get('subCategories') ?? [];
  const updatedSubs = subs.map(s => s.category === oldName ? { ...s, category: newName } : s);
  if (updatedSubs.some((s, i) => s.category !== subs[i].category)) {
    await writeAllRows(CONFIG.sheets.subCategories, updatedSubs.map(s => [s.category, s.subCategory]));
    store.set('subCategories', updatedSubs);
  }
}

async function _propagateIncomeSourceRename(oldName, newName) {
  const income = store.get('income') ?? [];
  const updatedIncome = income.map(r => r.source === oldName ? { ...r, source: newName } : r);
  if (updatedIncome.some((r, i) => r.source !== income[i].source)) {
    await writeAllRows(CONFIG.sheets.income, updatedIncome.map(r =>
      [r.date, r.source, String(r.amount), r.description, r.receivedIn ?? '']
    ));
    store.set('income', updatedIncome);
  }
}

async function _propagateVehicleExpenseTypeRename(oldName, newName) {
  const veList = store.get('vehicleExpenses') ?? [];
  const updatedVe = veList.map(e => e.expenseType === oldName ? { ...e, expenseType: newName } : e);
  if (updatedVe.some((e, i) => e.expenseType !== veList[i].expenseType)) {
    await writeAllRows(CONFIG.sheets.vehicleExp, updatedVe.map(e =>
      [e.id, e.vehicleName ?? '', e.date, e.expenseType ?? '', String(e.amount), e.paymentMethod ?? '', e.description ?? '']
    ));
    store.set('vehicleExpenses', updatedVe);
  }
}

// ─── Sub-categories ───────────────────────────────────────────────────────────

const SUBCAT_ROW_CHIPS_VISIBLE = 6; // chips per row before +N more

const _DOT_COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#3b82f6','#8b5cf6','#ec4899','#14b8a6'];
function _catDotColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return _DOT_COLORS[h % _DOT_COLORS.length];
}

function _renderSubCategories() {
  const container = document.getElementById('subcategories-list');
  if (!container) return;

  const records = store.get('subCategories') ?? [];

  if (records.length === 0) {
    container.innerHTML = '<p class="text-muted small">No sub-categories added yet.</p>';
    return;
  }

  const expandedMap = container._expandedMap ?? {};
  const suggestionKeyByNorm = Object.keys(CATEGORY_SUGGESTIONS).reduce((acc, key) => {
    acc[_norm(key)] = key;
    return acc;
  }, {});

  const grouped = {};
  records.forEach(r => {
    if (!grouped[r.category]) grouped[r.category] = [];
    grouped[r.category].push(r.subCategory);
  });

  const rows = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));
  rows.forEach(([, subs]) => subs.sort((a, b) => a.localeCompare(b)));
  const needsScroll = rows.length > 8;

  container.innerHTML = `
    <div class="sct-wrap${needsScroll ? ' sct-scrollable' : ''}">
      <table class="sct-table">
        <thead>
          <tr>
            <th class="sct-th-cat">Category</th>
            <th class="sct-th-subs">Sub-categories</th>
            <th class="sct-th-count">#</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(([cat, subs]) => {
            const exp = !!expandedMap[cat];
            const visible = exp ? subs : subs.slice(0, SUBCAT_ROW_CHIPS_VISIBLE);
            const hidden = subs.length - SUBCAT_ROW_CHIPS_VISIBLE;
            const suggestedKey = suggestionKeyByNorm[_norm(cat)] ?? null;
            const knownSubs = (suggestedKey ? CATEGORY_SUGGESTIONS[suggestedKey] : []).map(s => _norm(s));
            const dotColor = _catDotColor(cat);
            return `<tr class="sct-row">
              <td class="sct-td-cat"><span class="sct-cat-dot" style="background:${dotColor}"></span>${escapeHtml(cat)}</td>
              <td class="sct-td-subs">
                ${visible.map(sub => {
                  const isKnown = knownSubs.includes(_norm(sub));
                  return `<span class="cat-tag cat-tag-sub cat-tag-deletable${isKnown ? ' cat-tag-verified' : ''}">
                    ${isKnown ? '<i class="bi bi-check-circle-fill cat-tag-check-icon"></i>' : ''}
                    ${escapeHtml(sub)}
                    <button type="button" class="cat-tag-del"
                      data-delete-cat="${escapeHtml(cat)}"
                      data-delete-sub="${escapeHtml(sub)}">
                      <i class="bi bi-x"></i>
                    </button>
                  </span>`;
                }).join('')}
                ${!exp && hidden > 0
                  ? `<button type="button" class="cat-tag cat-tag-more sct-toggle" data-cat="${escapeHtml(cat)}">+${hidden} more</button>`
                  : exp && subs.length > SUBCAT_ROW_CHIPS_VISIBLE
                    ? `<button type="button" class="cat-tag cat-tag-more sct-toggle" data-cat="${escapeHtml(cat)}">Show less</button>`
                    : ''}
                <button type="button" class="sct-add-sub-btn" data-cat="${escapeHtml(cat)}" title="Add sub-category">
                  <i class="bi bi-plus-circle me-1"></i>Add
                </button>
              </td>
              <td class="sct-td-count"><span class="subcat-card-count">${subs.length}</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  container._expandedMap = expandedMap;

  container.querySelectorAll('[data-delete-sub]').forEach(btn => {
    btn.addEventListener('click', () => _handleDeleteSubCategory(btn.dataset.deleteCat, btn.dataset.deleteSub));
  });

  container.querySelectorAll('.sct-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      container._expandedMap[btn.dataset.cat] = !container._expandedMap[btn.dataset.cat];
      _renderSubCategories();
    });
  });

  container.querySelectorAll('.sct-add-sub-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      const parentSelect = document.getElementById('subcategory-parent');
      const nameInput    = document.getElementById('new-subcategory-name');
      if (parentSelect) parentSelect.value = cat;
      document.getElementById('subcategory-form')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setTimeout(() => nameInput?.focus(), 300);
    });
  });
}

// ─── Smart Suggestions from Expenses ─────────────────────────────────────────

const _SES_STOP = new Set([
  'from','at','for','to','in','on','by','via','using','through','the','a','an',
  'and','or','of','with','subscription','monthly','weekly','yearly','annual','bill',
  'payment','charge','recharge','fee','order','bought','purchase','daily','auto',
  'debit','credit','transfer','refund','cashback','online','offline','app','service',
  'morning','evening','night','today','yesterday','last','this','my','our','new','old',
  'quick','fast','instant','regular','special','extra','home','local','misc','other',
  'received','paid','done','booked','booking',
]);

function _extractMainTerm(description) {
  if (!description) return null;
  let text = description.trim();
  if (!text || text.length < 2) return null;

  // Strip currency amounts
  text = text.replace(/[₹$€£]?\s*\d[\d,.]*\s*[-\/]?/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text || text.length < 2) return null;

  const words = text.split(/\W+/)
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length >= 2 && !_SES_STOP.has(w) && !/^\d+$/.test(w));

  if (words.length === 0) return null;

  const termWords = words.slice(0, 2);
  const term = termWords[0].charAt(0).toUpperCase() + termWords[0].slice(1) +
    (termWords.length > 1 ? ' ' + termWords[1] : '');
  return term;
}

function _getSmartExpenseSuggestions() {
  const expenses     = store.get('expenses')       ?? [];
  const existingSubs = store.get('subCategories')  ?? [];
  const existingCats = getExpenseCategories();
  const existingCatSet = new Set(existingCats.map(c => _norm(c)));
  const existingSubSet = new Set(existingSubs.map(r => _norm(r.subCategory)));

  const termMap = {};

  expenses.forEach(e => {
    const term = _extractMainTerm(e.description);
    if (!term || term.length < 2) return;

    // Skip if this term is itself already a main category name
    if (existingCatSet.has(_norm(term))) return;

    const cat = e.category;
    if (!cat) return;

    const key = _norm(term);
    if (!termMap[key]) termMap[key] = { displayName: term, count: 0, categories: {} };
    termMap[key].count++;
    termMap[key].categories[cat] = (termMap[key].categories[cat] ?? 0) + 1;
  });

  return Object.values(termMap)
    .filter(t => t.count >= 3 && !existingSubSet.has(_norm(t.displayName)))
    .map(t => {
      const catEntries = Object.entries(t.categories).sort((a, b) => b[1] - a[1]);
      const [topCat, topCount] = catEntries[0];
      const confidence = Math.round((topCount / t.count) * 100);
      const catExists  = existingCatSet.has(_norm(topCat));
      return { term: t.displayName, count: t.count, suggestedParent: topCat, confidence, catExists, breakdown: catEntries };
    })
    .filter(s => s.catExists && s.confidence >= 60)
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

function _renderSmartExpenseSuggestions() {
  const container = document.getElementById('smart-expense-suggestions');
  if (!container) return;

  const suggestions = _getSmartExpenseSuggestions();

  if (suggestions.length === 0) {
    const expenses = store.get('expenses') ?? [];
    const msg = expenses.length < 10
      ? 'Add more expenses with descriptions to see personalised suggestions here.'
      : 'All frequent items from your expenses are already added as sub-categories!';
    container.innerHTML = `<p class="text-muted small mb-0"><i class="bi bi-info-circle me-1"></i>${msg}</p>`;
    return;
  }

  container.innerHTML = `<div class="ses-list">${suggestions.map(s => {
    const confColor = s.confidence >= 90 ? '#10b981' : s.confidence >= 70 ? '#f59e0b' : '#94a3b8';

    const breakdown = s.breakdown.length > 1
      ? `<div class="ses-breakdown">${s.breakdown.map(([cat, cnt]) =>
          `<span class="ses-bd-chip">${escapeHtml(cat)}&nbsp;<strong>${cnt}x</strong></span>`
        ).join('')}</div>`
      : '';

    return `
    <div class="ses-card" data-ses-term="${escapeHtml(s.term)}">
      <div class="ses-left">
        <span class="ses-item">${escapeHtml(s.term)}</span>
        <div class="ses-meta">
          <span class="ses-count"><i class="bi bi-receipt"></i>${s.count} expenses</span>
          <span class="ses-arrow">→</span>
          <span class="ses-dest">Sub-category under <strong>${escapeHtml(s.suggestedParent)}</strong></span>
          <span class="ses-conf" style="color:${confColor}">${s.confidence}% confidence</span>
        </div>
        ${breakdown}
      </div>
      <button class="ses-btn"
        data-ses-term="${escapeHtml(s.term)}"
        data-ses-parent="${escapeHtml(s.suggestedParent)}">
        <i class="bi bi-plus-circle"></i> Add
      </button>
    </div>`;
  }).join('')}</div>`;

  container.querySelectorAll('.ses-btn').forEach(btn => {
    btn.addEventListener('click', () => _quickAddFromExpense(btn));
  });
}

async function _quickAddFromExpense(btn) {
  const term   = btn.dataset.sesTerm;
  const parent = btn.dataset.sesParent;
  const normTerm = _norm(term);
  const normParent = _norm(parent);
  btn.disabled = true;
  btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Adding…';

  try {
    const existing = store.get('subCategories') ?? [];
    if (!existing.some(r => _norm(r.category) === normParent && _norm(r.subCategory) === normTerm)) {
      await appendRow(CONFIG.sheets.subCategories, [parent, term]);
      const rows = await fetchRows(CONFIG.sheets.subCategories);
      store.set('subCategories', rows.map(r => ({ category: r[0] ?? '', subCategory: r[1] ?? '' })).filter(r => r.category && r.subCategory));
    }
    const card = btn.closest('.ses-card');
    if (card) {
      btn.innerHTML = '<i class="bi bi-check-circle-fill"></i> Added!';
      btn.style.cssText = 'background:linear-gradient(135deg,#10b981,#059669);cursor:default';
      setTimeout(() => { card.style.transition = 'opacity .4s'; card.style.opacity = '0'; setTimeout(() => card.remove(), 400); }, 900);
    }
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-plus-circle"></i> Add';
    alert(err.message ?? 'Failed to add. Please try again.');
  }
}

// ─── Suggestions panel ───────────────────────────────────────────────────────

function _getCategoryUsageStats() {
  const expenses = store.get('expenses') ?? [];
  const cutoff   = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const stats = {};
  expenses.forEach(e => {
    if (!e.category) return;
    if (!stats[e.category]) stats[e.category] = { total: 0, recent: 0 };
    stats[e.category].total++;
    if (e.date && new Date(e.date) >= cutoff) stats[e.category].recent++;
  });
  return stats;
}

function _renderSuggestions() {
  const container = document.getElementById('cat-suggestions-panel');
  if (!container) return;

  const expenseCategoryRecords = store.get('expenseCategories') ?? [];
  const usingDefaults = expenseCategoryRecords.length === 0;
  const activeParents = usingDefaults
    ? [...DEFAULT_EXPENSE_CATEGORIES]
    : expenseCategoryRecords.map(r => r.name).filter(Boolean);

  const existingCats    = new Set(activeParents.map(c => _norm(c)));
  const suggestionKeys  = Object.keys(CATEGORY_SUGGESTIONS);
  const suggestionKeyByNorm = suggestionKeys.reduce((acc, key) => {
    acc[_norm(key)] = key;
    return acc;
  }, {});

  const existingSubs   = store.get('subCategories') ?? [];
  const existingSubMap = {};
  existingSubs.forEach(r => {
    const catKey = _norm(r.category);
    if (!catKey) return;
    if (!existingSubMap[catKey]) existingSubMap[catKey] = new Set();
    existingSubMap[catKey].add(_norm(r.subCategory));
  });

  // ── Get category usage from real expenses ──
  const usageStats = _getCategoryUsageStats();

  // ── Suggested parent categories not yet added ──
  const defaultSet    = new Set(DEFAULT_EXPENSE_CATEGORIES.map(d => _norm(d)));
  const missingParents = usingDefaults
    ? suggestionKeys.filter(p => !defaultSet.has(_norm(p)))
    : suggestionKeys.filter(p => !existingCats.has(_norm(p)));

  // ── Sub-category sections sorted by actual usage frequency ──
  const subSections = [];
  activeParents.forEach(cat => {
    const suggestedKey = suggestionKeyByNorm[_norm(cat)];
    if (!suggestedKey) return;
    const alreadyAdded = existingSubMap[_norm(cat)] ?? new Set();
    const seen = new Set();
    const missing = CATEGORY_SUGGESTIONS[suggestedKey].filter(s => {
      const key = _norm(s);
      if (!key || seen.has(key) || alreadyAdded.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (missing.length > 0) {
      const usage = usageStats[cat] ?? { total: 0, recent: 0 };
      subSections.push({ cat, missing, total: usage.total, recent: usage.recent });
    }
  });

  // Sort: categories with real spending appear first (recent > total > alphabetical)
  subSections.sort((a, b) => {
    if (b.recent !== a.recent) return b.recent - a.recent;
    if (b.total  !== a.total)  return b.total  - a.total;
    return a.cat.localeCompare(b.cat);
  });

  // ── Top picks: first 3 categories the user actually spends in ──
  const topPicks   = subSections.filter(s => s.total > 0).slice(0, 3);
  const otherSubs  = subSections.filter(s => !topPicks.includes(s));
  const unusedSubs = otherSubs.filter(s => s.total === 0);
  const usedOther  = otherSubs.filter(s => s.total > 0);

  const hasAnything = missingParents.length > 0 || subSections.length > 0;
  if (!hasAnything) {
    container.innerHTML = `<div class="text-success small"><i class="bi bi-check-circle-fill me-1"></i>All suggested categories are already added!</div>`;
    return;
  }

  let html = '';

  // ── Section 1: Top picks for you (based on actual spending) ──
  if (topPicks.length > 0) {
    html += `<div class="sug-dynamic-header">
      <i class="bi bi-fire me-1" style="color:#f97316"></i>
      <strong>Top picks for you</strong>
      <span class="sug-dynamic-hint">based on your ${subSections.filter(s=>s.total>0).length > 0 ? 'recent spending' : 'categories'}</span>
    </div>`;
    html += topPicks.map(({ cat, missing, total, recent }) => {
      const hint = recent > 0 ? `${recent} expense${recent > 1 ? 's' : ''} in last 90 days`
                 : total  > 0 ? `${total} expense${total > 1 ? 's' : ''} total`
                 : '';
      return `
      <div class="mb-2 sug-top-section">
        <div class="sug-section-label">
          <i class="bi bi-diagram-2 me-1"></i>${escapeHtml(cat)}
          ${hint ? `<span class="sug-usage-hint">${hint}</span>` : ''}
        </div>
        <div class="d-flex flex-wrap gap-1 mt-1">
          ${missing.map(s =>
            `<button class="cat-sug-chip cat-sug-chip--sub cat-sug-chip--hot" data-sug-type="sub" data-sug-parent="${escapeHtml(cat)}" data-sug-name="${escapeHtml(s)}">
              <i class="bi bi-plus-circle me-1"></i>${escapeHtml(s)}
            </button>`
          ).join('')}
        </div>
      </div>`;
    }).join('');
  }

  // ── Section 2: Other used categories ──
  if (usedOther.length > 0) {
    html += `<div class="sug-dynamic-header mt-2">
      <i class="bi bi-diagram-2-fill me-1" style="color:#6366f1"></i>
      <strong>More for your categories</strong>
    </div>`;
    html += usedOther.map(({ cat, missing, total }) => `
      <div class="mb-2">
        <div class="sug-section-label">
          <i class="bi bi-diagram-2 me-1"></i>${escapeHtml(cat)}
          <span class="sug-usage-hint">${total} expense${total !== 1 ? 's' : ''}</span>
        </div>
        <div class="d-flex flex-wrap gap-1 mt-1">
          ${missing.map(s =>
            `<button class="cat-sug-chip cat-sug-chip--sub" data-sug-type="sub" data-sug-parent="${escapeHtml(cat)}" data-sug-name="${escapeHtml(s)}">
              <i class="bi bi-plus-circle me-1"></i>${escapeHtml(s)}
            </button>`
          ).join('')}
        </div>
      </div>`
    ).join('');
  }

  // ── Section 3: Suggested parent categories ──
  if (missingParents.length > 0) {
    html += `<div class="sug-dynamic-header mt-2">
      <i class="bi bi-tag-fill me-1" style="color:#10b981"></i>
      <strong>Suggested parent categories</strong>
      <span class="sug-dynamic-hint">not in your list yet</span>
    </div>
    <div class="d-flex flex-wrap gap-1 mt-1 mb-2">
      ${missingParents.map(p =>
        `<button class="cat-sug-chip" data-sug-type="parent" data-sug-name="${escapeHtml(p)}">
          <i class="bi bi-plus-circle me-1"></i>${escapeHtml(p)}
        </button>`
      ).join('')}
    </div>`;
  }

  // ── Section 4: Unused categories (collapsed) ──
  if (unusedSubs.length > 0) {
    const detailId = 'sug-unused-detail';
    html += `<details class="sug-unused-details" id="${detailId}">
      <summary class="sug-unused-summary">
        <i class="bi bi-chevron-right sug-chevron me-1"></i>
        ${unusedSubs.length} more default suggestion${unusedSubs.length !== 1 ? 's' : ''} (no spending yet)
      </summary>
      <div class="sug-unused-body">
        ${unusedSubs.map(({ cat, missing }) => `
          <div class="mb-2">
            <div class="sug-section-label"><i class="bi bi-diagram-2 me-1"></i>${escapeHtml(cat)}</div>
            <div class="d-flex flex-wrap gap-1 mt-1">
              ${missing.map(s =>
                `<button class="cat-sug-chip cat-sug-chip--sub cat-sug-chip--dim" data-sug-type="sub" data-sug-parent="${escapeHtml(cat)}" data-sug-name="${escapeHtml(s)}">
                  <i class="bi bi-plus-circle me-1"></i>${escapeHtml(s)}
                </button>`
              ).join('')}
            </div>
          </div>`
        ).join('')}
      </div>
    </details>`;
  }

  container.innerHTML = html;

  container.querySelectorAll('.cat-sug-chip').forEach(btn => {
    btn.addEventListener('click', () => _quickAddSuggestion(btn));
  });
}

async function _quickAddSuggestion(btn) {
  btn.disabled = true;
  btn.innerHTML = `<i class="bi bi-hourglass-split me-1"></i>${escapeHtml(btn.dataset.sugName ?? '')}`;
  const type   = btn.dataset.sugType;
  const name   = btn.dataset.sugName?.trim() ?? '';
  const parent = btn.dataset.sugParent?.trim() ?? '';
  const normName = _norm(name);
  const normParent = _norm(parent);

  try {
    if (!name || (type === 'sub' && !parent)) {
      btn.disabled = false;
      return;
    }

    if (type === 'parent') {
      const existing = store.get('expenseCategories') ?? [];
      if (existing.some(r => _norm(r.name) === normName)) {
        btn.disabled = false;
        return;
      }
      await appendRow(CONFIG.sheets.expenseCategories, [name]);
      const rows = await fetchRows(CONFIG.sheets.expenseCategories);
      store.set('expenseCategories', rows.map(r => ({ name: r[0] ?? '' })).filter(r => r.name));
    } else {
      const existing = store.get('subCategories') ?? [];
      if (existing.some(r => _norm(r.category) === normParent && _norm(r.subCategory) === normName)) {
        btn.disabled = false;
        return;
      }
      await appendRow(CONFIG.sheets.subCategories, [parent, name]);
      const rows = await fetchRows(CONFIG.sheets.subCategories);
      store.set('subCategories', rows.map(r => ({ category: r[0] ?? '', subCategory: r[1] ?? '' })).filter(r => r.category && r.subCategory));
    }
  } catch (err) {
    btn.disabled = false;
    alert(err.message ?? 'Failed to add. Please try again.');
  }
}

async function _handleDeleteSubCategory(category, subCategory) {
  if (!await epConfirm(
    `Delete "${subCategory}" from "${category}"?`,
    'Delete Sub-category',
    'Delete'
  )) return;

  const records = store.get('subCategories') ?? [];
  const updated = records.filter(r => !(r.category === category && r.subCategory === subCategory));

  try {
    await writeAllRows(CONFIG.sheets.subCategories, updated.map(r => [r.category, r.subCategory]));
    store.set('subCategories', updated);
  } catch (err) {
    alert(err.message ?? 'Failed to delete. Please try again.');
  }
}

// ─── init() ──────────────────────────────────────────────────────────────────

export function init() {
  _bindForm('expense-category-form', 'new-expense-category', 'expenseCategories', CONFIG.sheets.expenseCategories, DEFAULT_EXPENSE_CATEGORIES);
  _bindForm('income-source-form', 'new-income-source', 'incomeSources', CONFIG.sheets.incomeSources, DEFAULT_INCOME_SOURCES);
  _bindForm('vehicle-expense-type-form', 'new-vehicle-expense-type', 'vehicleExpenseTypes', CONFIG.sheets.vehicleExpenseTypes, DEFAULT_VEHICLE_EXPENSE_TYPES);
  _bindSubCategoryForm();
  _bindResetButtons();
  _bindCategoryTabs();
  store.on('expenseCategories', render);
  store.on('incomeSources', render);
  store.on('subCategories', render);
  store.on('vehicleExpenseTypes', render);
  store.on('expenses', () => { _renderSuggestions(); _renderSmartExpenseSuggestions(); });
}

function _bindForm(formId, inputId, storeKey, sheetName, defaults = []) {
  const form = document.getElementById(formId);
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById(inputId);
    const name = nameInput?.value?.trim() ?? '';

    if (!name) {
      nameInput?.classList.add('is-invalid');
      return;
    }
    nameInput?.classList.remove('is-invalid');

    const existingRecords = store.get(storeKey) ?? [];
    const existingNames = existingRecords.map(r => r.name.toLowerCase());
    if (existingNames.includes(name.toLowerCase())) {
      nameInput?.classList.add('is-invalid');
      nameInput?.setCustomValidity('Already exists');
      return;
    }
    nameInput?.setCustomValidity('');

    try {
      if (existingRecords.length === 0 && defaults.length > 0) {
        await writeAllRows(sheetName, [...defaults.map(d => [d]), [name]]);
      } else {
        await appendRow(sheetName, [name]);
      }
      const rows = await fetchRows(sheetName);
      store.set(storeKey, rows.map(r => ({ name: r[0] ?? '' })).filter(r => r.name));
      form.reset();
    } catch (err) {
      alert(err.message ?? 'Failed to save. Please try again.');
    }
  });
}

function _bindResetButtons() {
  document.getElementById('reset-expense-categories-btn')?.addEventListener('click', () =>
    _handleResetToDefaults('expenseCategories', CONFIG.sheets.expenseCategories, DEFAULT_EXPENSE_CATEGORIES)
  );
  document.getElementById('reset-income-sources-btn')?.addEventListener('click', () =>
    _handleResetToDefaults('incomeSources', CONFIG.sheets.incomeSources, DEFAULT_INCOME_SOURCES)
  );
  document.getElementById('reset-vehicle-expense-types-btn')?.addEventListener('click', () =>
    _handleResetToDefaults('vehicleExpenseTypes', CONFIG.sheets.vehicleExpenseTypes, DEFAULT_VEHICLE_EXPENSE_TYPES)
  );
}

function _bindCategoryTabs() {
  const tabs   = document.querySelectorAll('.cat-tab-btn');
  const panels = document.querySelectorAll('.cat-panel');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.catTab;
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.add('d-none'));
      tab.classList.add('active');
      document.getElementById(`cat-panel-${target}`)?.classList.remove('d-none');
    });
  });
}

function _updateTabCounts() {
  const expCats    = getExpenseCategories();
  const incSources = getIncomeSources();
  const veTypes    = getVehicleExpenseTypes();
  const subs       = store.get('subCategories') ?? [];

  const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
  set('cat-tab-count-expense', expCats.length);
  set('cat-tab-count-income',  incSources.length);
  set('cat-tab-count-vehicle', veTypes.length);
  set('cat-stat-expense', expCats.length);
  set('cat-stat-income',  incSources.length);
  set('cat-stat-vehicle', veTypes.length);
  set('cat-stat-sub',     subs.length);
  set('subcat-total-badge', subs.length);

  const heroSub = document.getElementById('cat-hero-sub');
  if (heroSub) {
    const total = expCats.length + incSources.length + veTypes.length;
    heroSub.innerHTML = total > 0
      ? `<strong style="color:rgba(255,255,255,.95);font-weight:700">${total}</strong> categories across ${subs.length} sub-categories`
      : 'Manage expense categories &amp; sources';
  }
}

async function _handleResetToDefaults(storeKey, sheetName, defaults) {
  if (!await epConfirm(
    'This will replace your current list with the built-in defaults. Are you sure?',
    'Reset to Defaults',
    'Reset'
  )) return;
  try {
    await writeAllRows(sheetName, defaults.map(d => [d]));
    const rows = await fetchRows(sheetName);
    store.set(storeKey, rows.map(r => ({ name: r[0] ?? '' })).filter(r => r.name));
  } catch (err) {
    alert(err.message ?? 'Failed to reset. Please try again.');
  }
}

function _bindSubCategoryForm() {
  const form = document.getElementById('subcategory-form');
  if (!form) return;

  // Populate parent category dropdown from expenseCategories store
  function refreshParentSelect() {
    const select = document.getElementById('subcategory-parent');
    if (!select) return;
    const cats = getExpenseCategories().slice().sort((a, b) => a.localeCompare(b));
    const current = select.value;
    select.innerHTML = '<option value="">Select category…</option>' +
      cats.map(c => `<option value="${escapeHtml(c)}"${c === current ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
  }

  refreshParentSelect();
  store.on('expenseCategories', refreshParentSelect);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const parentSelect = document.getElementById('subcategory-parent');
    const nameInput = document.getElementById('new-subcategory-name');
    const category = parentSelect?.value?.trim() ?? '';
    const subCategory = nameInput?.value?.trim() ?? '';

    let hasError = false;
    if (!category) { parentSelect?.classList.add('is-invalid'); hasError = true; }
    else parentSelect?.classList.remove('is-invalid');
    if (!subCategory) { nameInput?.classList.add('is-invalid'); hasError = true; }
    else nameInput?.classList.remove('is-invalid');
    if (hasError) return;

    const existing = store.get('subCategories') ?? [];
    const duplicate = existing.some(r => _norm(r.category) === _norm(category) && _norm(r.subCategory) === _norm(subCategory));
    if (duplicate) {
      nameInput?.classList.add('is-invalid');
      nameInput?.setCustomValidity('Already exists');
      return;
    }
    nameInput?.setCustomValidity('');

    try {
      await appendRow(CONFIG.sheets.subCategories, [category, subCategory]);
      const rows = await fetchRows(CONFIG.sheets.subCategories);
      store.set('subCategories', rows.map(r => ({ category: r[0] ?? '', subCategory: r[1] ?? '' })).filter(r => r.category && r.subCategory));
      form.reset();
    } catch (err) {
      alert(err.message ?? 'Failed to save. Please try again.');
    }
  });
}
