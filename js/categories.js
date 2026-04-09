// js/categories.js — Manage expense categories and income sources
import { CONFIG } from './config.js';
import { appendRow, fetchRows, writeAllRows } from './api.js';
import * as store from './store.js';
import { requireFields } from './validation.js';

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
    CONFIG.sheets.expenseCategories
  );
  _renderList(
    'income-sources-list',
    store.get('incomeSources') ?? [],
    DEFAULT_INCOME_SOURCES,
    'incomeSources',
    CONFIG.sheets.incomeSources
  );
  _renderList(
    'vehicle-expense-types-list',
    store.get('vehicleExpenseTypes') ?? [],
    DEFAULT_VEHICLE_EXPENSE_TYPES,
    'vehicleExpenseTypes',
    CONFIG.sheets.vehicleExpenseTypes
  );
  _renderSubCategories();
  _renderSuggestions();
  refreshCategoryDropdowns();
}

const CAT_VISIBLE = 10;

function _renderList(containerId, records, defaults, storeKey, sheetName) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const hasCustom = records.length > 0;
  const items = (hasCustom ? records.map(r => r.name) : defaults).slice().sort((a, b) => a.localeCompare(b));
  const expanded = container._catExpanded ?? false;
  const visible = expanded ? items : items.slice(0, CAT_VISIBLE);
  const hiddenCount = items.length - CAT_VISIBLE;

  function makeTag(name) {
    return `<span class="cat-tag${hasCustom ? ' cat-tag-deletable' : ''}">
      ${escapeHtml(name)}
      ${hasCustom ? `<button type="button" class="cat-tag-del" aria-label="Delete ${escapeHtml(name)}" data-delete-name="${escapeHtml(name)}" data-store-key="${storeKey}" data-sheet="${sheetName}"><i class="bi bi-x"></i></button>` : ''}
    </span>`;
  }

  container.innerHTML = visible.map(makeTag).join('') +
    (!expanded && hiddenCount > 0
      ? `<button type="button" class="cat-tag cat-tag-more">+${hiddenCount} more</button>`
      : expanded && items.length > CAT_VISIBLE
        ? `<button type="button" class="cat-tag cat-tag-more">Show less</button>`
        : '');

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
  const records = store.get(storeKey) ?? [];
  const updated = records.filter(r => r.name !== name);

  try {
    await writeAllRows(sheetName, updated.map(r => [r.name]));
    store.set(storeKey, updated);
  } catch (err) {
    alert(err.message ?? 'Failed to delete. Please try again.');
  }
}

// ─── Sub-categories ───────────────────────────────────────────────────────────

const SUBCAT_ROW_CHIPS_VISIBLE = 6; // chips per row before +N more

function _renderSubCategories() {
  const container = document.getElementById('subcategories-list');
  if (!container) return;

  const records = store.get('subCategories') ?? [];

  if (records.length === 0) {
    container.innerHTML = '<p class="text-muted small">No sub-categories added yet.</p>';
    return;
  }

  const expandedMap = container._expandedMap ?? {};

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
            const knownSubs = (CATEGORY_SUGGESTIONS[cat] ?? []).map(s => s.toLowerCase());
            return `<tr class="sct-row">
              <td class="sct-td-cat"><span class="sct-cat-dot"></span>${escapeHtml(cat)}</td>
              <td class="sct-td-subs">
                ${visible.map(sub => {
                  const isKnown = knownSubs.includes(sub.toLowerCase());
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
}

// ─── Suggestions panel ───────────────────────────────────────────────────────

function _renderSuggestions() {
  const container = document.getElementById('cat-suggestions-panel');
  if (!container) return;

  const existingCats   = new Set((store.get('expenseCategories') ?? []).map(r => r.name.toLowerCase()));
  const existingSubs   = store.get('subCategories') ?? [];
  const existingSubMap = {};
  existingSubs.forEach(r => {
    if (!existingSubMap[r.category]) existingSubMap[r.category] = new Set();
    existingSubMap[r.category].add(r.subCategory.toLowerCase());
  });

  // 1. Suggested parent categories not yet added
  const usingDefaults = (store.get('expenseCategories') ?? []).length === 0;
  const missingParents = usingDefaults
    ? Object.keys(CATEGORY_SUGGESTIONS).filter(p =>
        !DEFAULT_EXPENSE_CATEGORIES.map(d => d.toLowerCase()).includes(p.toLowerCase())
      )
    : Object.keys(CATEGORY_SUGGESTIONS).filter(p => !existingCats.has(p.toLowerCase()));

  // 2. Suggested sub-categories per existing parent
  const allParents = usingDefaults ? DEFAULT_EXPENSE_CATEGORIES : [...existingCats].map(c =>
    (store.get('expenseCategories') ?? []).find(r => r.name.toLowerCase() === c)?.name ?? c
  );

  const subSections = [];
  allParents.forEach(cat => {
    const suggestedKey = Object.keys(CATEGORY_SUGGESTIONS).find(k => k.toLowerCase() === cat.toLowerCase());
    if (!suggestedKey) return;
    const alreadyAdded = existingSubMap[cat] ?? new Set();
    const missing = CATEGORY_SUGGESTIONS[suggestedKey].filter(s => !alreadyAdded.has(s.toLowerCase()));
    if (missing.length > 0) subSections.push({ cat, missing });
  });

  const hasAnything = missingParents.length > 0 || subSections.length > 0;
  if (!hasAnything) {
    container.innerHTML = `<div class="text-success small"><i class="bi bi-check-circle-fill me-1"></i>All suggested categories are already added!</div>`;
    return;
  }

  let html = '';

  if (missingParents.length > 0) {
    html += `<div class="mb-3">
      <div class="sug-section-label"><i class="bi bi-tag-fill me-1"></i>Suggested Parent Categories</div>
      <div class="d-flex flex-wrap gap-1 mt-1">
        ${missingParents.map(p =>
          `<button class="cat-sug-chip" data-sug-type="parent" data-sug-name="${escapeHtml(p)}">
            <i class="bi bi-plus-circle me-1"></i>${escapeHtml(p)}
          </button>`
        ).join('')}
      </div>
    </div>`;
  }

  if (subSections.length > 0) {
    html += subSections.map(({ cat, missing }) => `
      <div class="mb-2">
        <div class="sug-section-label"><i class="bi bi-diagram-2 me-1"></i>${escapeHtml(cat)}</div>
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

  container.innerHTML = html;

  container.querySelectorAll('.cat-sug-chip').forEach(btn => {
    btn.addEventListener('click', () => _quickAddSuggestion(btn));
  });
}

async function _quickAddSuggestion(btn) {
  btn.disabled = true;
  const type   = btn.dataset.sugType;
  const name   = btn.dataset.sugName;
  const parent = btn.dataset.sugParent;

  try {
    if (type === 'parent') {
      const existing = store.get('expenseCategories') ?? [];
      if (existing.some(r => r.name.toLowerCase() === name.toLowerCase())) return;
      await appendRow(CONFIG.sheets.expenseCategories, [name]);
      const rows = await fetchRows(CONFIG.sheets.expenseCategories);
      store.set('expenseCategories', rows.map(r => ({ name: r[0] ?? '' })).filter(r => r.name));
    } else {
      const existing = store.get('subCategories') ?? [];
      if (existing.some(r => r.category === parent && r.subCategory.toLowerCase() === name.toLowerCase())) return;
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
  _bindForm('expense-category-form', 'new-expense-category', 'expenseCategories', CONFIG.sheets.expenseCategories);
  _bindForm('income-source-form', 'new-income-source', 'incomeSources', CONFIG.sheets.incomeSources);
  _bindForm('vehicle-expense-type-form', 'new-vehicle-expense-type', 'vehicleExpenseTypes', CONFIG.sheets.vehicleExpenseTypes);
  _bindSubCategoryForm();
  store.on('expenseCategories', render);
  store.on('incomeSources', render);
  store.on('subCategories', render);
  store.on('vehicleExpenseTypes', render);
}

function _bindForm(formId, inputId, storeKey, sheetName) {
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

    const existing = (store.get(storeKey) ?? []).map(r => r.name.toLowerCase());
    if (existing.includes(name.toLowerCase())) {
      nameInput?.classList.add('is-invalid');
      nameInput?.setCustomValidity('Already exists');
      return;
    }
    nameInput?.setCustomValidity('');

    try {
      await appendRow(sheetName, [name]);
      const rows = await fetchRows(sheetName);
      store.set(storeKey, rows.map(r => ({ name: r[0] ?? '' })).filter(r => r.name));
      form.reset();
    } catch (err) {
      alert(err.message ?? 'Failed to save. Please try again.');
    }
  });
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
    const duplicate = existing.some(r => r.category === category && r.subCategory.toLowerCase() === subCategory.toLowerCase());
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
