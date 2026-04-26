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

const ICON_OPTIONS = [
  'bi-house-fill',
  'bi-bag-fill',
  'bi-piggy-bank-fill',
  'bi-graph-up-arrow',
  'bi-heart-fill',
  'bi-wallet2',
  'bi-lightning-charge-fill',
  'bi-car-front-fill',
  'bi-cup-hot-fill',
  'bi-shield-check',
  'bi-controller',
  'bi-bookmark-star-fill',
];

const DEFAULT_CUSTOM_BUCKETS = [
  { key: 'b1', label: 'Needs', hint: 'Rent, groceries, bills, EMIs', icon: 'bi-house-fill', pct: 50, type: 'spending' },
  { key: 'b2', label: 'Savings', hint: 'Keep in bank / emergency fund', icon: 'bi-piggy-bank-fill', pct: 30, type: 'savings' },
  { key: 'b3', label: 'Invest', hint: 'Stocks, mutual funds, SIPs', icon: 'bi-graph-up-arrow', pct: 20, type: 'spending' },
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
      { key: 'needs',   label: 'Needs',   icon: 'bi-house-fill',      color: '#6366f1', pct: 50, type: 'spending' },
      { key: 'wants',   label: 'Wants',   icon: 'bi-bag-fill',        color: '#f59e0b', pct: 30, type: 'spending' },
      { key: 'savings', label: 'Savings', icon: 'bi-piggy-bank-fill', color: '#10b981', pct: 20, type: 'savings' },
    ],
  },
  '70-20-10': {
    label: '70 / 20 / 10',
    description: 'Living · Savings · Giving',
    buckets: [
      { key: 'living',  label: 'Living',  icon: 'bi-house-fill',      color: '#6366f1', pct: 70, type: 'spending' },
      { key: 'savings', label: 'Savings', icon: 'bi-piggy-bank-fill', color: '#10b981', pct: 20, type: 'savings' },
      { key: 'giving',  label: 'Giving',  icon: 'bi-heart-fill',      color: '#ef4444', pct: 10, type: 'spending' },
    ],
  },
  '50-20-20-10': {
    label: '50 / 20 / 20 / 10',
    description: 'Needs · Savings · Invest · Wants',
    buckets: [
      { key: 'needs',   label: 'Needs',   icon: 'bi-house-fill',      color: '#6366f1', pct: 50, type: 'spending' },
      { key: 'savings', label: 'Savings', icon: 'bi-piggy-bank-fill', color: '#10b981', pct: 20, type: 'savings' },
      { key: 'invest',  label: 'Invest',  icon: 'bi-graph-up-arrow',  color: '#3b82f6', pct: 20, type: 'spending' },
      { key: 'wants',   label: 'Wants',   icon: 'bi-bag-fill',        color: '#f59e0b', pct: 10, type: 'spending' },
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
  monthKey: _currentMonthKey(),
  incomeScope: 'salary',
  customBuckets: _cloneBuckets(DEFAULT_CUSTOM_BUCKETS).map((b, i) => ({ ...b, color: _bucketColor(i) })),
  _customDraft: null,
  _openBucketIdx: 0,
  _mapBucketKey: null,
  // bucketKey → string[] of category names
  bucketCategoryMap: {},
};

function _cloneBuckets(buckets) {
  return (buckets ?? []).map(b => ({ ...b }));
}

function _currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function _monthLabel(monthKey) {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return 'Selected month';
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
}

function _daysInMonth(monthKey) {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return 30;
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function _inferBucketType(bucket) {
  if (bucket?.type === 'savings') return 'savings';
  const key = String(bucket?.key ?? '').toLowerCase().trim();
  const label = String(bucket?.label ?? '').toLowerCase().trim();
  return key === 'savings' || label === 'savings' ? 'savings' : 'spending';
}

function _normalizeCustomBuckets(buckets) {
  return (buckets ?? [])
    .filter(b => b.key !== '__catmap__' && !String(b.label ?? '').startsWith('{'))
    .map((b, i) => ({
      key: b.key ?? `b${i + 1}`,
      label: b.label ?? '',
      hint: b.hint ?? '',
      icon: b.icon ?? 'bi-wallet2',
      color: _bucketColor(i),
      pct: Number(b.pct) || 0,
      type: _inferBucketType(b),
    }));
}

function _normalizeState() {
  _state.monthKey = _state.monthKey && /^\d{4}-\d{2}$/.test(_state.monthKey) ? _state.monthKey : _currentMonthKey();
  _state.incomeScope = _state.incomeScope === 'all' ? 'all' : 'salary';
  _state.customBuckets = _normalizeCustomBuckets(_state.customBuckets);
  if (_state.customBuckets.length === 0) {
    _state.customBuckets = _cloneBuckets(DEFAULT_CUSTOM_BUCKETS).map((b, i) => ({ ...b, color: _bucketColor(i) }));
  }
  const mapped = _state.bucketCategoryMap ?? {};
  const cleaned = {};
  for (const [key, cats] of Object.entries(mapped)) {
    if (!Array.isArray(cats)) continue;
    cleaned[key] = [...new Set(cats.filter(Boolean))];
  }
  _state.bucketCategoryMap = cleaned;
  _state._openBucketIdx = Number.isInteger(_state._openBucketIdx) ? _state._openBucketIdx : 0;
}

async function _loadStateFromSheet() {
  try {
    const rows = await fetchRows(CONFIG.sheets.salarySplitter);
    if (!rows || rows.length === 0) {
      // Sheet empty — fall back to localStorage
      _loadStateFromLocalStorage();
      return;
    }
    // Row 0 is config: [__config__, preset, amount, _manualAmount, incomeScope, monthKey]
    const configRow = rows.find(r => r[0] === '__config__');
    if (configRow) {
      _state.preset        = configRow[1] || _state.preset;
      _state.amount        = configRow[2] || _state.amount;
      _state._manualAmount = configRow[3] === 'true';
      _state.incomeScope   = configRow[4] || _state.incomeScope;
      _state.monthKey      = configRow[5] || _state.monthKey;
    }
    // Remaining rows are buckets: [key, label, hint, icon, color, pct, type]
    const bucketRows = rows.filter(r => r[0] && r[0] !== '__config__' && r[0] !== '__catmap__');
    if (bucketRows.length > 0) {
      _state.customBuckets = bucketRows.map((r, i) => ({
        key:   r[0] ?? `b${i+1}`,
        label: r[1] ?? '',
        hint:  r[2] ?? '',
        icon:  r[3] ?? 'bi-circle-fill',
        color: _bucketColor(i),
        pct:   parseFloat(r[5]) || 0,
        type:  r[6] || undefined,
      }));
      // Parse bucketCategoryMap if stored in col 6
      try {
        const mapRow = rows.find(r => r[0] === '__catmap__');
        if (mapRow && mapRow[1]) _state.bucketCategoryMap = JSON.parse(mapRow[1]);
      } catch { /* ignore */ }
    }
    _normalizeState();
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
  _normalizeState();
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
      ['__config__', _state.preset, _state.amount, String(!!_state._manualAmount), _state.incomeScope, _state.monthKey],
      ..._state.customBuckets.map(b => [b.key, b.label, b.hint ?? '', b.icon ?? '', b.color ?? '', String(b.pct), b.type ?? 'spending']),
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

/** Returns selected month's total income from store */
function _getMonthIncome(monthKey = _state.monthKey, incomeScope = _state.incomeScope) {
  const income = store.get('income') ?? [];
  return income
    .filter(e => {
      if (!String(e.date ?? '').startsWith(monthKey)) return false;
      if (incomeScope === 'all') return true;
      return /salary/i.test(e.source ?? '');
    })
    .reduce((s, e) => s + (e.amount ?? 0), 0);
}
function _getMonthSpendByCategory(monthKey = _state.monthKey) {
  const expenses = store.get('expenses') ?? [];
  const map = {};
  for (const e of expenses) {
    if (!String(e.date ?? '').startsWith(monthKey)) continue;
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

  _normalizeState();
  const monthLabel = _monthLabel(_state.monthKey);
  // Auto-fill from selected month's income if user hasn't set a custom amount
  const monthIncome = _getMonthIncome(_state.monthKey, _state.incomeScope);
  if (!_state.amount && monthIncome > 0) {
    _state.amount = String(monthIncome);
    _saveState();
  }

  container.innerHTML = `
  <div class="spl-page">
    <div class="spl-hero">
      <div>
        <div class="spl-hero-title">Salary Splitter</div>
        <div class="spl-hero-sub">Plan your income allocation across savings, expenses, and goals</div>
      </div>
    </div>

    <div class="spl-shell" id="spl-shell">
      <aside class="spl-setup-col">
        <div class="spl-stage-card spl-stage-card--setup">
          <div class="spl-stage-head">
            <span class="spl-stage-step">Step 1</span>
            <div>
              <div class="spl-stage-title">Set income</div>
              <div class="spl-stage-sub">Pick month/source and lock your base amount</div>
            </div>
          </div>

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

            <div class="spl-controls-row">
              <label class="spl-control-group">
                <span class="spl-control-label">Month</span>
                <input type="month" id="spl-month-input" class="spl-control-input" value="${esc(_state.monthKey)}" />
              </label>
              <label class="spl-control-group">
                <span class="spl-control-label">Income Source</span>
                <select id="spl-income-scope" class="spl-control-input">
                  <option value="salary" ${_state.incomeScope === 'salary' ? 'selected' : ''}>Salary only</option>
                  <option value="all" ${_state.incomeScope === 'all' ? 'selected' : ''}>All income</option>
                </select>
              </label>
            </div>

            ${monthIncome > 0 ? `
            <div class="spl-income-hint">
              <i class="bi bi-arrow-down-circle-fill me-1"></i>
              ${esc(monthLabel)} income (${_state.incomeScope === 'all' ? 'all sources' : 'salary only'}): <strong>${fmt(monthIncome)}</strong>
              ${parseFloat(_state.amount) !== monthIncome
                ? `<button class="spl-use-income-btn" id="spl-use-income" title="Use selected month income">Use this</button>`
                : `<span class="spl-income-active"><i class="bi bi-check-circle-fill me-1"></i>Using selected income</span>`}
            </div>` : ''}
          </div>
        </div>

        <div id="spl-setup-dynamic"></div>
      </aside>

      <section class="spl-output-col" id="spl-output-dynamic"></section>
    </div>

    <div id="spl-below-dynamic"></div>
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
  const setupEl = document.getElementById('spl-setup-dynamic');
  const outputEl = document.getElementById('spl-output-dynamic');
  const shellEl = document.getElementById('spl-shell');
  const belowEl = document.getElementById('spl-below-dynamic');
  const pageEl = document.getElementById('tab-salary-splitter');
  if (!setupEl || !outputEl || !shellEl || !belowEl || !pageEl) return;

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

  setupEl.innerHTML = `
    <div class="spl-stage-card">
      <div class="spl-stage-head">
        <span class="spl-stage-step">Step 2</span>
        <div>
          <div class="spl-stage-title">Choose split mode</div>
          <div class="spl-stage-sub">Use preset rules or fine-tune your custom allocation</div>
        </div>
      </div>

      <div class="spl-presets spl-presets--segmented">
      ${Object.entries(PRESETS).map(([key, p]) => `
        <button class="spl-preset-btn${_state.preset === key ? ' spl-preset-btn--active' : ''}" data-preset="${key}">
          <span class="spl-preset-label">${esc(p.label)}</span>
          <span class="spl-preset-desc">${esc(p.description)}</span>
        </button>
      `).join('')}
      </div>

      ${isCustom
        ? _renderCustomEditor(buckets, totalPct)
        : `<div class="spl-custom-note"><i class="bi bi-info-circle me-1"></i>Switch to <strong>Custom</strong> to edit bucket names, icons, types and percentages.</div>`}
    </div>
  `;

  outputEl.innerHTML = `
    <div class="spl-stage-stack">
      <div class="spl-stage-card">
        <div class="spl-stage-head">
          <span class="spl-stage-step">Step 3</span>
          <div>
            <div class="spl-stage-title">Allocation preview</div>
            <div class="spl-stage-sub">Review monthly, weekly and daily split breakdown</div>
          </div>
        </div>
        ${isValid
          ? _renderResults(amount, buckets, _state.monthKey)
          : _renderPlaceholder(amount, totalPct, buckets.length)}
      </div>
    </div>
  `;

  belowEl.innerHTML = isValid ? `<div class="spl-stage-card">
    <div class="spl-stage-head">
      <span class="spl-stage-step">Step 4</span>
      <div>
        <div class="spl-stage-title">Track performance</div>
        <div class="spl-stage-sub">Compare actual spend against your selected plan</div>
      </div>
    </div>
    ${_renderTracker(amount, buckets, _state.monthKey)}
  </div>` : '';

  _bindDynamicEvents(pageEl);
}

// ─── Tracker section ──────────────────────────────────────────────────────────

function _renderTracker(amount, buckets, monthKey) {
  const spendByCat  = _getMonthSpendByCategory(monthKey);
  const allCats     = _getAllCategories();
  const monthLabel  = _monthLabel(monthKey);

  // Compute per-bucket data
  const bucketData = buckets.map(b => {
    const allocated  = (amount * (Number(b.pct) || 0)) / 100;
    const mappedCats = _state.bucketCategoryMap[b.key] ?? [];
    const spent      = mappedCats.reduce((s, cat) => s + (spendByCat[cat] ?? 0), 0);
    return { ...b, allocated, mappedCats, spent };
  });

  const mapTarget = bucketData.find(b => b.key === _state._mapBucketKey && b.type !== 'savings') ?? null;
  if (!mapTarget) _state._mapBucketKey = null;

  // Total actual spend this month (all expenses, not just mapped)
  const totalActualSpend = Object.values(spendByCat).reduce((s, v) => s + v, 0);
  const actualSavings    = amount - totalActualSpend;

  // Planned savings = sum of buckets marked as savings type
  const plannedSavings = bucketData
    .filter(b => b.type === 'savings')
    .reduce((s, b) => s + b.allocated, 0);
  const savingsDiff    = actualSavings - plannedSavings;
  const spendPct       = amount > 0 ? Math.min((totalActualSpend / amount) * 100, 100) : 0;
  const plannedSpendPct = amount > 0 ? Math.min(Math.max(((amount - plannedSavings) / amount) * 100, 0), 100) : 0;

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
    const isSavingsBucket = b.type === 'savings';

    const actualRemaining  = amount - totalActualSpend;
    const displayRemaining = isSavingsBucket ? actualRemaining : (allocated - spent);
    const pctUsed          = isSavingsBucket
      ? (allocated > 0 ? Math.min(Math.max((actualRemaining / allocated) * 100, 0), 100) : 0)
      : (allocated > 0 ? Math.min((spent / allocated) * 100, 100) : 0);
    const over = !isSavingsBucket && spent > allocated;

    const hint = _getBucketHint(b);

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
        ${!isSavingsBucket ? `<button class="spl-tracker-map-btn${_state._mapBucketKey === b.key ? ' spl-tracker-map-btn--active' : ''}" data-map-bucket="${esc(b.key)}">
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
    </div>`;
  }).join('');

  const drawerOptions = mapTarget
    ? allCats.map(cat => {
      const checked = (mapTarget.mappedCats ?? []).includes(cat);
      return `<label class="spl-cat-option${checked ? ' spl-cat-option--checked' : ''}">
        <input type="checkbox" class="spl-cat-cb" data-bucket="${esc(mapTarget.key)}" data-cat="${esc(cat)}" ${checked ? 'checked' : ''} />
        ${esc(cat)}
      </label>`;
    }).join('')
    : '';

  const drawer = mapTarget
    ? `<div class="spl-map-drawer">
      <div class="spl-map-drawer-head">
        <div>
          <div class="spl-map-drawer-title">Map categories to ${esc(mapTarget.label)}</div>
          <div class="spl-map-drawer-sub">Each category can belong to only one bucket.</div>
        </div>
        <button class="spl-map-drawer-close" data-close-map type="button"><i class="bi bi-x-lg"></i></button>
      </div>
      ${allCats.length > 0 ? `<div class="spl-cat-grid">${drawerOptions}</div>` : `<div class="spl-cat-empty">No expense categories found. Add some expenses first.</div>`}
    </div>`
    : '';

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
      ${plannedSavings > 0 ? `<div class="spl-ss-bar-marker" style="left:${plannedSpendPct.toFixed(1)}%" title="Planned spend boundary"></div>` : ''}
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
    ${drawer}
    <div class="spl-tc-grid">${cards}</div>
    ${summaryBar}
  </div>`;
}

// ─── HTML builders ────────────────────────────────────────────────────────────

function _renderResults(amount, buckets, monthKey) {
  const segments = [];
  let cumOffset = 0;
  const r = 80, cx = 100, cy = 100, sw = 28;
  const circ = 2 * Math.PI * r;
  const daysInMonth = _daysInMonth(monthKey);
  const weeksInMonth = daysInMonth / 7;

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
    <div class="spl-results-actions">
      <button class="spl-copy-btn" id="spl-copy-plan"><i class="bi bi-clipboard me-1"></i>Copy Split Summary</button>
    </div>
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
        const daily  = alloc / daysInMonth;
        const weekly = alloc / weeksInMonth;
        return `
        <div class="spl-alloc-card" style="border-top-color:${esc(s.color)}">
          <div class="spl-alloc-top">
            <div class="spl-alloc-icon" style="background:rgba(${s.color.match(/#?([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})/i)?.slice?.(1).map(x=>parseInt(x,16)).join(',') || '99,102,241'},.1);color:${esc(s.color)}">
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
          <span class="spl-sum-val">${fmt(alloc / weeksInMonth)}</span>
          <span class="spl-sum-val">${fmt(alloc / daysInMonth)}</span>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function _buildSplitSummaryText(amount, buckets, monthKey) {
  const daysInMonth = _daysInMonth(monthKey);
  const weeksInMonth = daysInMonth / 7;
  const lines = [
    `Salary Split Summary — ${_monthLabel(monthKey)}`,
    `Total Amount: ${fmt(amount)}`,
    '',
  ];
  for (const b of buckets) {
    const pct = Number(b.pct) || 0;
    const alloc = (amount * pct) / 100;
    lines.push(`${b.label} (${pct}%): ${fmt(alloc)} | Weekly ~${fmt(alloc / weeksInMonth)} | Daily ~${fmt(alloc / daysInMonth)}`);
  }
  return lines.join('\n');
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
      <button class="spl-reset-custom-btn" id="spl-reset-custom"><i class="bi bi-arrow-counterclockwise me-1"></i>Reset</button>
      <button class="spl-add-bucket-btn" id="spl-add-bucket"><i class="bi bi-plus-lg me-1"></i>Add</button>
    </div>
    <div class="spl-bucket-list">
      ${buckets.map((b, i) => `
        <div class="spl-bucket-item${_state._openBucketIdx === i ? ' spl-bucket-item--open' : ''}" style="--bc:${esc(b.color)}">
          <button class="spl-bucket-head" data-toggle-bucket="${i}" type="button">
            <span class="spl-bucket-dot" style="background:${esc(b.color)}"></span>
            <span class="spl-bucket-head-main">${esc(b.label || 'Untitled bucket')}</span>
            <span class="spl-bucket-head-meta">${Number(b.pct) || 0}% · ${b.type === 'savings' ? 'Savings' : 'Spend'}</span>
            <i class="bi ${_state._openBucketIdx === i ? 'bi-chevron-up' : 'bi-chevron-down'}"></i>
          </button>

          <div class="spl-bucket-body" style="${_state._openBucketIdx === i ? '' : 'display:none'}">
            <div class="spl-bucket-row">
              <select class="spl-bucket-icon" data-field="icon" data-idx="${i}" title="Bucket icon">
                ${ICON_OPTIONS.map(icon => `<option value="${icon}" ${icon === b.icon ? 'selected' : ''}>${icon.replace('bi-', '').replaceAll('-', ' ')}</option>`).join('')}
              </select>
              <input type="text" class="spl-bucket-name" value="${esc(b.label)}" data-field="label" data-idx="${i}" placeholder="Label" />
              <input type="text" class="spl-bucket-hint-input" value="${esc(b.hint ?? '')}" data-field="hint" data-idx="${i}" placeholder="${esc(_hintPlaceholder(b.label))}" />
              <select class="spl-bucket-type" data-field="type" data-idx="${i}" title="Bucket type">
                <option value="spending" ${b.type === 'spending' ? 'selected' : ''}>Spend</option>
                <option value="savings" ${b.type === 'savings' ? 'selected' : ''}>Savings</option>
              </select>
              <div class="spl-bucket-pct-wrap">
                <input type="number" class="spl-bucket-pct" value="${b.pct}" data-field="pct" data-idx="${i}" min="0" max="100" step="1" />
                <span class="spl-bucket-pct-sym">%</span>
              </div>
              <button class="spl-bucket-del" data-del-idx="${i}" title="Remove" type="button"><i class="bi bi-x-lg"></i></button>
            </div>
          </div>
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

  const monthInput = container.querySelector('#spl-month-input');
  if (monthInput) {
    monthInput.addEventListener('change', () => {
      _state.monthKey = monthInput.value || _currentMonthKey();
      if (!_state._manualAmount) {
        const monthIncome = _getMonthIncome(_state.monthKey, _state.incomeScope);
        _state.amount = monthIncome > 0 ? String(monthIncome) : '';
      }
      _saveState();
      render();
    });
  }

  const incomeScope = container.querySelector('#spl-income-scope');
  if (incomeScope) {
    incomeScope.addEventListener('change', () => {
      _state.incomeScope = incomeScope.value === 'all' ? 'all' : 'salary';
      if (!_state._manualAmount) {
        const monthIncome = _getMonthIncome(_state.monthKey, _state.incomeScope);
        _state.amount = monthIncome > 0 ? String(monthIncome) : '';
      }
      _saveState();
      render();
    });
  }
}

function _bindDynamicEvents(dynEl) {
  // Preset buttons
  dynEl.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const nextPreset = btn.dataset.preset;
      if (_state.preset === 'custom' && nextPreset !== 'custom') {
        _state._customDraft = _cloneBuckets(_state.customBuckets);
      }
      if (nextPreset === 'custom' && Array.isArray(_state._customDraft) && _state._customDraft.length > 0) {
        _state.customBuckets = _normalizeCustomBuckets(_state._customDraft);
      }
      _state.preset = nextPreset;
      _state._mapBucketKey = null;
      _saveState();
      _updateDynamic();
    });
  });

  dynEl.querySelectorAll('[data-toggle-bucket]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.toggleBucket);
      _state._openBucketIdx = _state._openBucketIdx === idx ? -1 : idx;
      _updateDynamic();
    });
  });

  // Custom bucket field changes — debounce ALL fields, restore focus after re-render
  dynEl.querySelectorAll('[data-field]').forEach(input => {
    const handleFieldChange = () => {
      const idx   = parseInt(input.dataset.idx);
      const field = input.dataset.field;
      const val   = field === 'pct' ? (parseFloat(input.value) || 0) : input.value;
      _state.customBuckets[idx] = { ..._state.customBuckets[idx], [field]: val };
      // After any change, re-apply palette colors so they stay unique
      _state.customBuckets = _normalizeCustomBuckets(_state.customBuckets);
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
    };
    input.addEventListener('input', handleFieldChange);
    input.addEventListener('change', handleFieldChange);
  });

  // Delete bucket
  dynEl.querySelectorAll('[data-del-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.delIdx);
      const removed = _state.customBuckets[idx];
      _state.customBuckets.splice(idx, 1);
      if (removed?.key) delete _state.bucketCategoryMap[removed.key];
      if (_state._mapBucketKey === removed?.key) _state._mapBucketKey = null;
      if (_state._openBucketIdx >= _state.customBuckets.length) _state._openBucketIdx = _state.customBuckets.length - 1;
      _saveState();
      _updateDynamic();
    });
  });

  const resetBtn = dynEl.querySelector('#spl-reset-custom');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      _state.customBuckets = _cloneBuckets(DEFAULT_CUSTOM_BUCKETS).map((b, i) => ({ ...b, color: _bucketColor(i) }));
      _state.bucketCategoryMap = {};
      _state._customDraft = _cloneBuckets(_state.customBuckets);
      _state._openBucketIdx = 0;
      _state._mapBucketKey = null;
      _saveState();
      _updateDynamic();
    });
  }

  // Add bucket
  const addBtn = dynEl.querySelector('#spl-add-bucket');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const color = _bucketColor(_state.customBuckets.length);
      _state.customBuckets.push({ key: `b${Date.now()}`, label: 'New Bucket', hint: '', icon: 'bi-wallet2', color, pct: 0, type: 'spending' });
      _state._openBucketIdx = _state.customBuckets.length - 1;
      _saveState();
      _updateDynamic();
    });
  }

  const copyBtn = dynEl.querySelector('#spl-copy-plan');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const amount = parseFloat(_state.amount) || 0;
      const buckets = _getActiveBuckets();
      if (!(amount > 0) || buckets.length === 0) return;
      const text = _buildSplitSummaryText(amount, buckets, _state.monthKey);
      let copied = false;
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'absolute';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          copied = document.execCommand('copy');
          document.body.removeChild(ta);
        } catch { /* ignore */ }
      }
      if (copied) {
        const old = copyBtn.innerHTML;
        copyBtn.innerHTML = '<i class="bi bi-check2 me-1"></i>Copied';
        copyBtn.disabled = true;
        setTimeout(() => {
          copyBtn.innerHTML = old;
          copyBtn.disabled = false;
        }, 1200);
      }
    });
  }

  // Tracker: Map button toggles global category drawer
  dynEl.querySelectorAll('[data-map-bucket]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.mapBucket;
      _state._mapBucketKey = _state._mapBucketKey === key ? null : key;
      _updateDynamic();
    });
  });

  const closeMapBtn = dynEl.querySelector('[data-close-map]');
  if (closeMapBtn) {
    closeMapBtn.addEventListener('click', () => {
      _state._mapBucketKey = null;
      _updateDynamic();
    });
  }

  // Tracker: Category checkbox toggle
  dynEl.querySelectorAll('.spl-cat-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const bucketKey = cb.dataset.bucket;
      const cat       = cb.dataset.cat;
      if (!_state.bucketCategoryMap[bucketKey]) _state.bucketCategoryMap[bucketKey] = [];
      if (cb.checked) {
        for (const key of Object.keys(_state.bucketCategoryMap)) {
          _state.bucketCategoryMap[key] = (_state.bucketCategoryMap[key] ?? []).filter(c => c !== cat);
        }
        if (!_state.bucketCategoryMap[bucketKey].includes(cat)) {
          _state.bucketCategoryMap[bucketKey].push(cat);
        }
      } else {
        _state.bucketCategoryMap[bucketKey] = _state.bucketCategoryMap[bucketKey].filter(c => c !== cat);
      }
      _saveState();
      _state._mapBucketKey = bucketKey;
      _updateDynamic();
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
    const monthIncome = _getMonthIncome(_state.monthKey, _state.incomeScope);
    // Only auto-update if user hasn't manually overridden
    if (!_state._manualAmount) {
      _state.amount = monthIncome > 0 ? String(monthIncome) : '';
      _saveState();
    }
    render();
  });
}
