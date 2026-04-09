// js/salary-splitter.js — Salary / Money Splitter + Budget Tracker

import * as store from './store.js';
import { CONFIG } from './config.js';
import { fetchRows, writeAllRows } from './api.js';

const LS_KEY = 'salary-splitter-state';

// ─── Preset rules ─────────────────────────────────────────────────────────────

const BUCKET_HINTS = {
  needs:   'Rent, groceries, bills, EMIs',
  wants:   'Dining out, shopping, entertainment',
  savings: 'Keep in bank / emergency fund',
  invest:  'Stocks, mutual funds, SIPs',
  living:  'All day-to-day living costs',
  giving:  'Donations, charity, family gifts',
};

// Also match by label for custom buckets
const LABEL_HINTS = {
  needs:   'Rent, groceries, bills, EMIs',
  wants:   'Dining out, shopping, entertainment',
  savings: 'Keep in bank / emergency fund',
  invest:  'Stocks, mutual funds, SIPs',
  living:  'All day-to-day living costs',
  giving:  'Donations, charity, family gifts',
  emi:     'Monthly loan repayment',
  loan:    'Monthly loan repayment',
  rent:    'House / flat rent',
  food:    'Groceries, dining, snacks',
  travel:  'Fuel, transport, trips',
  health:  'Medical, insurance, gym',
  bills:   'Electricity, internet, phone',
  fun:     'Entertainment, hobbies, outings',
  family:  'Family expenses & gifts',
  charity: 'Donations & charity',
  misc:    'Other / miscellaneous expenses',
};

// 16 distinct colors — enough to avoid repeats for any reasonable number of buckets
const BUCKET_COLORS = [
  '#6366f1', // indigo
  '#f59e0b', // amber
  '#10b981', // green  (Savings)
  '#ef4444', // red
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#84cc16', // lime
  '#06b6d4', // cyan
  '#a855f7', // purple
  '#e11d48', // rose
  '#0ea5e9', // sky
  '#d97706', // dark amber
  '#16a34a', // dark green
];

function _bucketColor(idx) {
  return BUCKET_COLORS[idx % BUCKET_COLORS.length];
}

function _hintPlaceholder(label) {
  const l = (label ?? '').toLowerCase().trim();
  if (!l || l === 'new bucket') return 'e.g. What this bucket covers…';
  return `e.g. What counts as "${label}"…`;
}

function _getBucketHint(b) {
  // Custom bucket's own hint takes priority
  if (b.hint?.trim()) return b.hint.trim();
  // Then try by key, then by label (lowercase)
  return BUCKET_HINTS[b.key] ?? LABEL_HINTS[b.label?.toLowerCase().trim()] ?? null;
}

const PRESETS = {
  '50-30-20': {
    label: '50 / 30 / 20',
    description: 'Needs · Wants · Savings',
    buckets: [
      { key: 'needs',   label: 'Needs',   icon: 'bi-house-fill',      color: '#6366f1', pct: 50 },
      { key: 'wants',   label: 'Wants',   icon: 'bi-bag-fill',        color: '#f59e0b', pct: 30 },
      { key: 'savings', label: 'Savings', icon: 'bi-piggy-bank-fill', color: '#10b981', pct: 20 },
    ],
  },
  '70-20-10': {
    label: '70 / 20 / 10',
    description: 'Living · Savings · Giving',
    buckets: [
      { key: 'living',  label: 'Living',  icon: 'bi-house-fill',      color: '#6366f1', pct: 70 },
      { key: 'savings', label: 'Savings', icon: 'bi-piggy-bank-fill', color: '#10b981', pct: 20 },
      { key: 'giving',  label: 'Giving',  icon: 'bi-heart-fill',      color: '#ef4444', pct: 10 },
    ],
  },
  '50-20-20-10': {
    label: '50 / 20 / 20 / 10',
    description: 'Needs · Savings · Invest · Wants',
    buckets: [
      { key: 'needs',   label: 'Needs',   icon: 'bi-house-fill',      color: '#6366f1', pct: 50 },
      { key: 'savings', label: 'Savings', icon: 'bi-piggy-bank-fill', color: '#10b981', pct: 20 },
      { key: 'invest',  label: 'Invest',  icon: 'bi-graph-up-arrow',  color: '#3b82f6', pct: 20 },
      { key: 'wants',   label: 'Wants',   icon: 'bi-bag-fill',        color: '#f59e0b', pct: 10 },
    ],
  },
  'custom': {
    label: 'Custom',
    description: 'Define your own split',
    buckets: [],
  },
};

// ─── State ────────────────────────────────────────────────────────────────────

let _state = {
  amount: '',
  preset: '50-30-20',
  customBuckets: [
    { key: 'b1', label: 'Needs',   hint: 'Rent, groceries, bills, EMIs',   icon: 'bi-house-fill',      color: '#6366f1', pct: 50 },
    { key: 'b2', label: 'Savings', hint: 'Keep in bank / emergency fund',  icon: 'bi-piggy-bank-fill', color: '#10b981', pct: 30 },
    { key: 'b3', label: 'Invest',  hint: 'Stocks, mutual funds, SIPs',     icon: 'bi-graph-up-arrow',  color: '#3b82f6', pct: 20 },
  ],
  // bucketKey → string[] of category names
  bucketCategoryMap: {},
};

async function _loadStateFromSheet() {
  try {
    const rows = await fetchRows(CONFIG.sheets.salarySplitter);
    if (!rows || rows.length === 0) {
      // Sheet empty — fall back to localStorage
      _loadStateFromLocalStorage();
      return;
    }
    // Row 0 is config: [__config__, preset, amount, _manualAmount]
    const configRow = rows.find(r => r[0] === '__config__');
    if (configRow) {
      _state.preset        = configRow[1] || _state.preset;
      _state.amount        = configRow[2] || _state.amount;
      _state._manualAmount = configRow[3] === 'true';
    }
    // Remaining rows are buckets: [key, label, hint, icon, color, pct, ...categoryMap JSON]
    const bucketRows = rows.filter(r => r[0] && r[0] !== '__config__' && r[0] !== '__catmap__');
    if (bucketRows.length > 0) {
      _state.customBuckets = bucketRows.map((r, i) => ({
        key:   r[0] ?? `b${i+1}`,
        label: r[1] ?? '',
        hint:  r[2] ?? '',
        icon:  r[3] ?? 'bi-circle-fill',
        color: _bucketColor(i),
        pct:   parseFloat(r[5]) || 0,
      }));
      // Parse bucketCategoryMap if stored in col 6
      try {
        const mapRow = rows.find(r => r[0] === '__catmap__');
        if (mapRow && mapRow[1]) _state.bucketCategoryMap = JSON.parse(mapRow[1]);
      } catch { /* ignore */ }
    }
  } catch {
    // Sheet fetch failed — fall back to localStorage
    _loadStateFromLocalStorage();
  }
}

function _loadStateFromLocalStorage() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null');
    if (saved) _state = { ..._state, ...saved };
  } catch { /* ignore */ }
  // Remove any corrupted entries (e.g. __catmap__ row saved as a bucket)
  _state.customBuckets = (_state.customBuckets ?? [])
    .filter(b => b.key !== '__catmap__' && !String(b.label ?? '').startsWith('{'))
    .map((b, i) => ({ ...b, color: _bucketColor(i) }));
}

let _saveTimer = null;
function _saveState() {
  // Always keep localStorage in sync as a fast fallback
  try { localStorage.setItem(LS_KEY, JSON.stringify(_state)); } catch { /* ignore */ }
  // Debounce sheet writes to avoid hammering on every keystroke
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(_saveStateToSheet, 800);
}

async function _saveStateToSheet() {
  try {
    const rows = [
      ['__config__', _state.preset, _state.amount, String(!!_state._manualAmount)],
      ..._state.customBuckets.map(b => [b.key, b.label, b.hint ?? '', b.icon ?? '', b.color ?? '', String(b.pct)]),
      ['__catmap__', JSON.stringify(_state.bucketCategoryMap ?? {})],
    ];
    await writeAllRows(CONFIG.sheets.salarySplitter, rows);
  } catch { /* silently ignore — localStorage still has the data */ }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n) {
  return '₹' + Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _getActiveBuckets() {
  if (_state.preset === 'custom') return _state.customBuckets;
  return PRESETS[_state.preset]?.buckets ?? [];
}

/** Returns current month's total income from store — Salary source only */
function _getMonthIncome() {
  const now    = new Date();
  const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const income = store.get('income') ?? [];
  return income
    .filter(e => String(e.date ?? '').startsWith(prefix) && /salary/i.test(e.source ?? ''))
    .reduce((s, e) => s + (e.amount ?? 0), 0);
}
function _getMonthSpendByCategory() {
  const now   = new Date();
  const yyyy  = now.getFullYear();
  const mm    = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `${yyyy}-${mm}`;

  const expenses = store.get('expenses') ?? [];
  const map = {};
  for (const e of expenses) {
    if (!String(e.date ?? '').startsWith(prefix)) continue;
    const cat = e.category ?? 'Uncategorized';
    map[cat] = (map[cat] ?? 0) + (e.amount ?? 0);
  }
  return map;
}

/** All unique expense categories from store */
function _getAllCategories() {
  const cats = store.get('expenseCategories') ?? [];
  // expenseCategories is array of objects with .name or plain strings
  return cats.map(c => (typeof c === 'string' ? c : c.name ?? '')).filter(Boolean).sort();
}

// ─── Full render (called once on tab open) ────────────────────────────────────

export function render() {
  const container = document.getElementById('tab-salary-splitter');
  if (!container) return;

  // Auto-fill from current month's income if user hasn't set a custom amount
  const monthIncome = _getMonthIncome();
  if (!_state.amount && monthIncome > 0) {
    _state.amount = String(monthIncome);
    _saveState();
  }

  container.innerHTML = `
  <div class="spl-page">
    <div class="spl-header">
      <div class="spl-header-left">
        <div class="spl-title"><i class="bi bi-calculator-fill me-2"></i>Salary Splitter</div>
        <div class="spl-subtitle">Enter your income and choose a split rule to see your allocation</div>
      </div>
    </div>

    <!-- Amount input — never re-rendered -->
    <div class="spl-input-card">
      <div class="spl-input-wrap">
        <span class="spl-input-prefix">₹</span>
        <input
          type="number"
          id="spl-amount-input"
          class="spl-amount-input"
          placeholder="Enter your salary or amount…"
          value="${esc(_state.amount)}"
          min="0"
          step="1"
        />
      </div>
      <div id="spl-amount-display" class="spl-amount-display" style="${parseFloat(_state.amount) > 0 ? '' : 'display:none'}">
        ${fmt(parseFloat(_state.amount) || 0)}
      </div>
      ${monthIncome > 0 ? `
      <div class="spl-income-hint">
        <i class="bi bi-arrow-down-circle-fill me-1"></i>
        This month's salary: <strong>${fmt(monthIncome)}</strong>
        ${parseFloat(_state.amount) !== monthIncome
          ? `<button class="spl-use-income-btn" id="spl-use-income" title="Use salary amount">Use this</button>`
          : `<span class="spl-income-active"><i class="bi bi-check-circle-fill me-1"></i>Using salary</span>`}
      </div>` : ''}
    </div>

    <!-- Dynamic section (presets + editor + results + tracker) -->
    <div id="spl-dynamic"></div>
  </div>`;

  _bindAmountInput(container);
  // "Use this" button
  const useBtn = container.querySelector('#spl-use-income');
  if (useBtn) {
    useBtn.addEventListener('click', () => {
      _state.amount = String(monthIncome);
      _state._manualAmount = false; // reset — follow income again
      _saveState();
      const inp = container.querySelector('#spl-amount-input');
      if (inp) inp.value = _state.amount;
      render();
    });
  }
  _updateDynamic();
}

// ─── Partial update ───────────────────────────────────────────────────────────

function _updateDynamic() {
  const dynEl = document.getElementById('spl-dynamic');
  if (!dynEl) return;

  const amount   = parseFloat(_state.amount) || 0;
  const buckets  = _getActiveBuckets();
  const totalPct = buckets.reduce((s, b) => s + (Number(b.pct) || 0), 0);
  const isValid  = amount > 0 && totalPct === 100 && buckets.length > 0;
  const isCustom = _state.preset === 'custom';

  const dispEl = document.getElementById('spl-amount-display');
  if (dispEl) {
    dispEl.textContent = fmt(amount);
    dispEl.style.display = amount > 0 ? '' : 'none';
  }

  dynEl.innerHTML = `
    <div class="spl-presets">
      ${Object.entries(PRESETS).map(([key, p]) => `
        <button class="spl-preset-btn${_state.preset === key ? ' spl-preset-btn--active' : ''}" data-preset="${key}">
          <span class="spl-preset-label">${esc(p.label)}</span>
          <span class="spl-preset-desc">${esc(p.description)}</span>
        </button>
      `).join('')}
    </div>

    ${isCustom ? _renderCustomEditor(buckets, totalPct) : ''}

    ${isValid
      ? _renderResults(amount, buckets)
      : _renderPlaceholder(amount, totalPct, buckets.length)}

    ${isValid ? _renderTracker(amount, buckets) : ''}
  `;

  _bindDynamicEvents(dynEl);
}

// ─── Tracker section ──────────────────────────────────────────────────────────

function _renderTracker(amount, buckets) {
  const spendByCat  = _getMonthSpendByCategory();
  const allCats     = _getAllCategories();
  const now         = new Date();
  const monthLabel  = now.toLocaleString('default', { month: 'long', year: 'numeric' });

  // Compute per-bucket data
  const bucketData = buckets.map(b => {
    const allocated  = (amount * (Number(b.pct) || 0)) / 100;
    const mappedCats = _state.bucketCategoryMap[b.key] ?? [];
    const spent      = mappedCats.reduce((s, cat) => s + (spendByCat[cat] ?? 0), 0);
    return { ...b, allocated, mappedCats, spent };
  });

  // Total actual spend this month (all expenses, not just mapped)
  const totalActualSpend = Object.values(spendByCat).reduce((s, v) => s + v, 0);
  const actualSavings    = amount - totalActualSpend;

  // Planned savings = sum of buckets whose label is exactly "savings"
  const plannedSavings = bucketData
    .filter(b => /^savings$/i.test(b.label.trim()))
    .reduce((s, b) => s + b.allocated, 0);
  const savingsDiff    = actualSavings - plannedSavings;
  const spendPct       = amount > 0 ? Math.min((totalActualSpend / amount) * 100, 100) : 0;

  // SVG ring helper — 100px, centered
  function _ring(pct, color, over, isSavings) {
    const r = 42, circ = 2 * Math.PI * r;
    const fill = Math.min(Math.max(pct, 0), 100);
    const dash = (fill / 100) * circ;
    const ringColor = over ? '#ef4444' : color;
    const lbl = over ? 'over budget' : (isSavings ? 'saved' : (pct >= 100 ? 'fully used' : 'used'));
    return `
      <svg class="spl-tc-ring-svg" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="${r}" fill="none" stroke="#f1f5f9" stroke-width="9"/>
        <circle cx="50" cy="50" r="${r}" fill="none" stroke="${ringColor}" stroke-width="9"
          stroke-dasharray="${dash.toFixed(2)} ${(circ - dash).toFixed(2)}"
          stroke-linecap="round"
          transform="rotate(-90 50 50)"
          style="transition:stroke-dasharray .6s ease"/>
        <text x="50" y="46" text-anchor="middle" class="spl-tc-ring-pct">${fill.toFixed(0)}%</text>
        <text x="50" y="60" text-anchor="middle" class="spl-tc-ring-lbl">${lbl}</text>
      </svg>`;
  }

  const cards = bucketData.map(b => {
    const { allocated, mappedCats, spent } = b;
    const isSavingsBucket = /^savings$/i.test(b.label.trim());

    const actualRemaining  = amount - totalActualSpend;
    const displayRemaining = isSavingsBucket ? actualRemaining : (allocated - spent);
    const pctUsed          = isSavingsBucket
      ? (allocated > 0 ? Math.min(Math.max((actualRemaining / allocated) * 100, 0), 100) : 0)
      : (allocated > 0 ? Math.min((spent / allocated) * 100, 100) : 0);
    const over = !isSavingsBucket && spent > allocated;

    const hint = _getBucketHint(b);

    const catOptions = allCats.map(cat => `
      <label class="spl-cat-option${mappedCats.includes(cat) ? ' spl-cat-option--checked' : ''}">
        <input type="checkbox" class="spl-cat-cb" data-bucket="${esc(b.key)}" data-cat="${esc(cat)}"
          ${mappedCats.includes(cat) ? 'checked' : ''} />
        ${esc(cat)}
      </label>`).join('');

    // Collapsed category tags — show first 3, rest hidden
    const visibleCats = mappedCats.slice(0, 3);
    const hiddenCount = mappedCats.length - visibleCats.length;
    const catTagsHtml = mappedCats.length > 0
      ? `${visibleCats.map(c => `<span class="spl-cat-tag">${esc(c)}</span>`).join('')}${hiddenCount > 0 ? `<span class="spl-cat-tag spl-cat-tag--more">+${hiddenCount} more</span>` : ''}`
      : `<span class="spl-tracker-no-cats">No categories mapped</span>`;

    return `
    <div class="spl-tc-card" style="--bucket-color:${esc(b.color)}">
      <!-- Top accent bar -->
      <div class="spl-tc-accent" style="background:${esc(b.color)}"></div>

      <!-- Header: icon + label + map btn -->
      <div class="spl-tc-head">
        <div class="spl-tc-icon" style="background:${esc(b.color)}18;color:${esc(b.color)}">
          <i class="bi ${esc(b.icon)}"></i>
        </div>
        <div class="spl-tc-info">
          <div class="spl-tc-name">${esc(b.label)}${isSavingsBucket ? ' <span class="spl-savings-badge">Actual</span>' : ''}</div>
          ${hint ? `<div class="spl-tc-hint">${esc(hint)}</div>` : ''}
        </div>
        ${!isSavingsBucket ? `<button class="spl-tracker-map-btn" data-map-bucket="${esc(b.key)}">
          <i class="bi bi-tag-fill"></i>
        </button>` : ''}
      </div>

      <!-- Ring centered -->
      <div class="spl-tc-ring-wrap">
        ${_ring(pctUsed, b.color, over, isSavingsBucket)}
      </div>

      <!-- Amount rows: 3 stats -->
      <div class="spl-tc-stats">
        <div class="spl-tc-stat">
          <span class="spl-tc-stat-lbl">Allocated</span>
          <span class="spl-tc-stat-val">${fmt(allocated)}</span>
        </div>
        <div class="spl-tc-stat-div"></div>
        <div class="spl-tc-stat">
          <span class="spl-tc-stat-lbl">${isSavingsBucket ? 'Saved' : 'Spent'}</span>
          <span class="spl-tc-stat-val" style="color:${isSavingsBucket ? '#10b981' : (over ? '#ef4444' : 'inherit')}">
            ${fmt(isSavingsBucket ? Math.max(actualRemaining, 0) : spent)}
          </span>
        </div>
        <div class="spl-tc-stat-div"></div>
        <div class="spl-tc-stat">
          <span class="spl-tc-stat-lbl">${isSavingsBucket ? 'Total Spent' : 'Remaining'}</span>
          <span class="spl-tc-stat-val" style="color:${isSavingsBucket ? '#ef4444' : (over ? '#ef4444' : 'inherit')}">
            ${fmt(isSavingsBucket ? totalActualSpend : Math.max(displayRemaining, 0))}
          </span>
        </div>
      </div>

      <!-- Status chip — just ok/over, no repeated amount -->
      ${over
        ? `<div class="spl-tc-chip spl-tc-chip--over"><i class="bi bi-exclamation-triangle-fill"></i>Over by ${fmt(Math.abs(displayRemaining))}</div>`
        : isSavingsBucket
          ? (actualRemaining < 0 ? `<div class="spl-tc-chip spl-tc-chip--over"><i class="bi bi-exclamation-triangle-fill"></i>Overspent by ${fmt(Math.abs(actualRemaining))}</div>` : '')
          : ''
      }

      <!-- Category tags (collapsed) -->
      <div class="spl-tc-cats">
        ${isSavingsBucket
          ? `<span class="spl-tracker-no-cats"><i class="bi bi-info-circle me-1"></i>Salary − Total Expenses</span>`
          : catTagsHtml}
      </div>

      <!-- Category picker -->
      ${!isSavingsBucket ? `<div class="spl-cat-picker" id="spl-cat-picker-${esc(b.key)}" style="display:none">
        <div class="spl-cat-picker-title">Map categories → <strong>${esc(b.label)}</strong></div>
        ${allCats.length > 0
          ? `<div class="spl-cat-grid">${catOptions}</div>`
          : `<div class="spl-cat-empty">No expense categories found. Add some expenses first.</div>`}
      </div>` : ''}
    </div>`;
  }).join('');

  // Savings summary bar
  const savingsColor = actualSavings >= 0 ? '#10b981' : '#ef4444';
  const savingsIcon  = actualSavings >= 0 ? 'bi-piggy-bank-fill' : 'bi-exclamation-triangle-fill';
  const diffText = savingsDiff >= 0
    ? `<span style="color:#10b981"><i class="bi bi-arrow-up-short"></i>You saved ${fmt(savingsDiff)} more than planned — great job!</span>`
    : `<span style="color:#ef4444"><i class="bi bi-arrow-down-short"></i>You spent ${fmt(Math.abs(savingsDiff))} more than expected — savings reduced by this amount</span>`;

  const summaryBar = `
  <div class="spl-savings-summary">
    <div class="spl-ss-row">
      <div class="spl-ss-item">
        <div class="spl-ss-label">Salary</div>
        <div class="spl-ss-val">${fmt(amount)}</div>
      </div>
      <div class="spl-ss-sep"><i class="bi bi-dash"></i></div>
      <div class="spl-ss-item">
        <div class="spl-ss-label">Total Spent</div>
        <div class="spl-ss-val" style="color:#ef4444">${fmt(totalActualSpend)}</div>
      </div>
      <div class="spl-ss-sep"><i class="bi bi-equals"></i></div>
      <div class="spl-ss-item spl-ss-item--highlight" style="border-color:${savingsColor}20;background:${savingsColor}08">
        <div class="spl-ss-label">Actual Savings</div>
        <div class="spl-ss-val" style="color:${savingsColor}">
          <i class="bi ${savingsIcon} me-1"></i>${fmt(actualSavings)}
        </div>
      </div>
    </div>
    <div class="spl-ss-bar-wrap">
      <div class="spl-ss-bar-spent" style="width:${spendPct.toFixed(1)}%"></div>
    </div>
    <div class="spl-ss-foot">
      <span style="color:#64748b;font-size:.78rem">${spendPct.toFixed(0)}% of salary spent</span>
      ${plannedSavings > 0 ? `<span style="font-size:.78rem">${diffText}</span>` : ''}
    </div>
  </div>`;

  return `
  <div class="spl-tracker">
    <div class="spl-tracker-hd">
      <div>
        <div class="spl-tracker-title"><i class="bi bi-bar-chart-fill me-2"></i>Budget Tracker</div>
        <div class="spl-tracker-subtitle">Actual spending vs your plan · ${monthLabel}</div>
      </div>
    </div>
    <div class="spl-tc-grid">${cards}</div>
    ${summaryBar}
  </div>`;
}

// ─── HTML builders ────────────────────────────────────────────────────────────

function _renderResults(amount, buckets) {
  const segments = [];
  let cumOffset = 0;
  const r = 80, cx = 100, cy = 100, sw = 28;
  const circ = 2 * Math.PI * r;

  for (const b of buckets) {
    const pct  = Number(b.pct) || 0;
    const dash = (pct / 100) * circ;
    const gap  = circ - dash;
    segments.push({ ...b, pct, dash, gap, offset: cumOffset });
    cumOffset += dash;
  }

  const svgPaths = segments.map(s =>
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${esc(s.color)}" stroke-width="${sw}"
      stroke-dasharray="${s.dash.toFixed(2)} ${s.gap.toFixed(2)}"
      stroke-dashoffset="${(-s.offset).toFixed(2)}"
      transform="rotate(-90 ${cx} ${cy})"
      class="spl-donut-seg" />`
  ).join('');

  return `
  <div class="spl-results">
    <div class="spl-visual">
      <div class="spl-donut-wrap">
        <svg viewBox="0 0 200 200" class="spl-donut-svg">
          <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#f1f5f9" stroke-width="${sw}" />
          ${svgPaths}
          <text x="${cx}" y="${cy - 8}" text-anchor="middle" class="spl-donut-total-label">Total</text>
          <text x="${cx}" y="${cy + 14}" text-anchor="middle" class="spl-donut-total-val">${fmt(amount)}</text>
        </svg>
      </div>
      <div class="spl-legend">
        ${segments.map(s => `
          <div class="spl-legend-item">
            <span class="spl-legend-dot" style="background:${esc(s.color)}"></span>
            <span class="spl-legend-label">${esc(s.label)}</span>
            <span class="spl-legend-pct">${s.pct}%</span>
          </div>`).join('')}
      </div>
    </div>

    <div class="spl-cards">
      ${segments.map(s => {
        const alloc  = (amount * s.pct) / 100;
        const daily  = alloc / 30;
        const weekly = alloc / 4.33;
        return `
        <div class="spl-alloc-card">
          <div class="spl-alloc-top">
            <div class="spl-alloc-icon" style="background:${esc(s.color)}20;color:${esc(s.color)}">
              <i class="bi ${esc(s.icon)}"></i>
            </div>
            <div class="spl-alloc-meta">
              <div class="spl-alloc-name">${esc(s.label)}</div>
              <div class="spl-alloc-pct">${s.pct}% of income${_getBucketHint(s) ? ` · <span class="spl-alloc-hint">${esc(_getBucketHint(s))}</span>` : ''}</div>
            </div>
            <div class="spl-alloc-amount" style="color:${esc(s.color)}">${fmt(alloc)}</div>
          </div>
          <div class="spl-alloc-bar-wrap">
            <div class="spl-alloc-bar" style="width:${s.pct}%;background:${esc(s.color)}"></div>
          </div>
          <div class="spl-alloc-foot">
            <span class="spl-alloc-sub"><i class="bi bi-calendar3 me-1"></i>~${fmt(daily)}/day</span>
            <span class="spl-alloc-sub"><i class="bi bi-calendar-week me-1"></i>~${fmt(weekly)}/week</span>
          </div>
        </div>`;
      }).join('')}
    </div>

    <div class="spl-summary-table">
      <div class="spl-sum-hd">
        <span>Bucket</span><span>Monthly</span><span>Weekly</span><span>Daily</span>
      </div>
      ${segments.map(s => {
        const alloc = (amount * s.pct) / 100;
        return `<div class="spl-sum-row">
          <span class="spl-sum-name">
            <span class="spl-sum-dot" style="background:${esc(s.color)}"></span>${esc(s.label)}
          </span>
          <span class="spl-sum-val">${fmt(alloc)}</span>
          <span class="spl-sum-val">${fmt(alloc / 4.33)}</span>
          <span class="spl-sum-val">${fmt(alloc / 30)}</span>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function _renderPlaceholder(amount, totalPct, bucketCount) {
  if (amount <= 0) {
    return `<div class="spl-placeholder">
      <i class="bi bi-calculator spl-placeholder-icon"></i>
      <div class="spl-placeholder-title">Enter an amount above</div>
      <div class="spl-placeholder-sub">Type your salary or any amount to see the split breakdown</div>
    </div>`;
  }
  if (bucketCount === 0) {
    return `<div class="spl-placeholder">
      <i class="bi bi-plus-circle spl-placeholder-icon"></i>
      <div class="spl-placeholder-title">Add at least one bucket</div>
      <div class="spl-placeholder-sub">Use the editor above to add spending categories</div>
    </div>`;
  }
  const diff = 100 - totalPct;
  return `<div class="spl-placeholder spl-placeholder--warn">
    <i class="bi bi-exclamation-triangle-fill spl-placeholder-icon" style="color:#f59e0b"></i>
    <div class="spl-placeholder-title">Percentages must add up to 100%</div>
    <div class="spl-placeholder-sub">Currently at <strong>${totalPct}%</strong> — ${diff > 0 ? `add ${diff}% more` : `reduce by ${Math.abs(diff)}%`}</div>
  </div>`;
}

function _renderCustomEditor(buckets, totalPct) {
  const warn = totalPct !== 100;
  return `
  <div class="spl-custom-editor">
    <div class="spl-custom-hd">
      <span class="spl-custom-hd-title"><i class="bi bi-sliders me-1"></i>Custom Buckets</span>
      <span class="spl-pct-total ${warn ? 'spl-pct-total--warn' : 'spl-pct-total--ok'}">${totalPct}% / 100%</span>
      <button class="spl-add-bucket-btn" id="spl-add-bucket"><i class="bi bi-plus-lg me-1"></i>Add</button>
    </div>
    <div class="spl-bucket-list">
      ${buckets.map((b, i) => `
        <div class="spl-bucket-row" style="--bc:${esc(b.color)}">
          <span class="spl-bucket-dot" style="background:${esc(b.color)}"></span>
          <input type="text" class="spl-bucket-name" value="${esc(b.label)}" data-field="label" data-idx="${i}" placeholder="Label" />
          <input type="text" class="spl-bucket-hint-input" value="${esc(b.hint ?? '')}" data-field="hint" data-idx="${i}" placeholder="${esc(_hintPlaceholder(b.label))}" />
          <div class="spl-bucket-pct-wrap">
            <input type="number" class="spl-bucket-pct" value="${b.pct}" data-field="pct" data-idx="${i}" min="0" max="100" step="1" />
            <span class="spl-bucket-pct-sym">%</span>
          </div>
          <button class="spl-bucket-del" data-del-idx="${i}" title="Remove"><i class="bi bi-x-lg"></i></button>
        </div>`).join('')}
    </div>
  </div>`;
}

// ─── Event binding ────────────────────────────────────────────────────────────

let _dynDebounceTimer = null;
function _debouncedUpdate(delay = 400) {
  clearTimeout(_dynDebounceTimer);
  _dynDebounceTimer = setTimeout(() => _updateDynamic(), delay);
}

function _bindAmountInput(container) {
  const input = container.querySelector('#spl-amount-input');
  if (!input) return;
  input.addEventListener('input', () => {
    _state.amount = input.value;
    _state._manualAmount = true; // user explicitly typed — don't auto-overwrite
    _saveState();
    _updateDynamic();
  });
}

function _bindDynamicEvents(dynEl) {
  // Preset buttons
  dynEl.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      _state.preset = btn.dataset.preset;
      _saveState();
      _updateDynamic();
    });
  });

  // Custom bucket field changes — debounce ALL fields, restore focus after re-render
  dynEl.querySelectorAll('[data-field]').forEach(input => {
    input.addEventListener('input', () => {
      const idx   = parseInt(input.dataset.idx);
      const field = input.dataset.field;
      const val   = field === 'pct' ? (parseFloat(input.value) || 0) : input.value;
      _state.customBuckets[idx] = { ..._state.customBuckets[idx], [field]: val };
      // After any change, re-apply palette colors so they stay unique
      _state.customBuckets = _state.customBuckets.map((b, i) => ({ ...b, color: _bucketColor(i) }));
      _saveState();
      const selStart = input.selectionStart;
      const selEnd   = input.selectionEnd;
      clearTimeout(_dynDebounceTimer);
      _dynDebounceTimer = setTimeout(() => {
        _updateDynamic();
        // Restore focus + cursor to the same field after re-render
        const restored = dynEl.querySelector(`[data-field="${field}"][data-idx="${idx}"]`);
        if (restored) {
          restored.focus();
          try { restored.setSelectionRange(selStart, selEnd); } catch { /* number inputs ignore this */ }
        }
      }, 600);
    });
  });

  // Delete bucket
  dynEl.querySelectorAll('[data-del-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      _state.customBuckets.splice(parseInt(btn.dataset.delIdx), 1);
      _saveState();
      _updateDynamic();
    });
  });

  // Add bucket
  const addBtn = dynEl.querySelector('#spl-add-bucket');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const COLORS = ['#6366f1','#f59e0b','#10b981','#ef4444','#3b82f6','#8b5cf6','#ec4899','#14b8a6'];
      const color = _bucketColor(_state.customBuckets.length);
      _state.customBuckets.push({ key: `b${Date.now()}`, label: 'New Bucket', hint: '', icon: 'bi-wallet2', color, pct: 0 });
      _saveState();
      _updateDynamic();
    });
  }

  // Tracker: Map button toggles category picker
  dynEl.querySelectorAll('[data-map-bucket]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key    = btn.dataset.mapBucket;
      const picker = dynEl.querySelector(`#spl-cat-picker-${key}`);
      if (!picker) return;
      const isOpen = picker.style.display !== 'none';
      // Close all pickers first
      dynEl.querySelectorAll('.spl-cat-picker').forEach(p => { p.style.display = 'none'; });
      if (!isOpen) picker.style.display = '';
    });
  });

  // Tracker: Category checkbox toggle
  dynEl.querySelectorAll('.spl-cat-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const bucketKey = cb.dataset.bucket;
      const cat       = cb.dataset.cat;
      if (!_state.bucketCategoryMap[bucketKey]) _state.bucketCategoryMap[bucketKey] = [];
      if (cb.checked) {
        if (!_state.bucketCategoryMap[bucketKey].includes(cat)) {
          _state.bucketCategoryMap[bucketKey].push(cat);
        }
      } else {
        _state.bucketCategoryMap[bucketKey] = _state.bucketCategoryMap[bucketKey].filter(c => c !== cat);
      }
      _saveState();
      // Re-render tracker only — keep picker open by re-rendering full dynamic
      // We need to preserve open picker state
      const openPickerKey = bucketKey;
      _updateDynamic();
      // Re-open the picker after re-render
      const picker = dynEl.querySelector(`#spl-cat-picker-${openPickerKey}`);
      if (picker) picker.style.display = '';
    });
  });
}

// ─── init ─────────────────────────────────────────────────────────────────────

export async function init() {
  // Load from localStorage first for instant render, then sync from sheet
  _loadStateFromLocalStorage();
  render();
  // Then load from sheet and re-render if data differs
  await _loadStateFromSheet();
  render();

  // Re-render when income data changes (new salary added)
  store.on('income', () => {
    const monthIncome = _getMonthIncome();
    // Only auto-update if user hasn't manually overridden
    if (!_state._manualAmount && monthIncome > 0) {
      _state.amount = String(monthIncome);
      _saveState();
    }
    render();
  });
}
