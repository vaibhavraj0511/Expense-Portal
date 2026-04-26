// js/ai-insights.js — AI Insights view/render layer
import * as store from './store.js';
import { computeAll, computeIncomeExpenseRatio, classifyCategory, computeSpendingDayTiers } from './insights.js';

const LS_KEY = 'ai-insights-dismissed';

// ─── localStorage helpers ─────────────────────────────────────────────────────

function getDismissed() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]'); }
  catch { return []; }
}
function dismissRecommendation(category) {
  try {
    const d = getDismissed();
    if (!d.includes(category)) { d.push(category); localStorage.setItem(LS_KEY, JSON.stringify(d)); }
  } catch { /* ignore */ }
  render();
}
function resetDismissed() {
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  render();
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function fmt(n) {
  return '₹' + Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
function fmtPct(n) {
  if (n === null || n === undefined) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
}
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtTime(d) {
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function drawSparkline(canvas, values, direction) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const color = direction === 'Increasing' ? '#ef4444' : direction === 'Decreasing' ? '#10b981' : '#6366f1';
  if (!values || values.length < 2) {
    ctx.strokeStyle = color + '55';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const pad = 3;
  const xStep = (W - pad * 2) / (values.length - 1);
  const pts = values.map((v, i) => ({ x: pad + i * xStep, y: H - pad - ((v - min) / range) * (H - pad * 2) }));
  ctx.beginPath();
  ctx.moveTo(pts[0].x, H);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts[pts.length - 1].x, H);
  ctx.closePath();
  ctx.fillStyle = color + '18';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
  // dot at last point
  ctx.beginPath();
  ctx.arc(pts[pts.length - 1].x, pts[pts.length - 1].y, 3, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

// ─── Donut SVG ────────────────────────────────────────────────────────────────

function buildDonut(pct) {
  const r = 42, cx = 60, cy = 60, sw = 16;
  const circ = 2 * Math.PI * r;
  const disc = (pct / 100) * circ;
  return `<svg class="ai-donut-svg" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="${sw}" />
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#64748b" stroke-width="${sw}"
      stroke-dasharray="${circ}" stroke-dashoffset="0" transform="rotate(-90 ${cx} ${cy})" />
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#6366f1" stroke-width="${sw}"
      stroke-dasharray="${disc} ${circ - disc}" stroke-dashoffset="0" transform="rotate(-90 ${cx} ${cy})" />
    <text x="${cx}" y="${cy - 6}" text-anchor="middle" dominant-baseline="middle" class="ai-donut-pct">${pct.toFixed(0)}%</text>
    <text x="${cx}" y="${cy + 10}" text-anchor="middle" dominant-baseline="middle" class="ai-donut-sub">disc.</text>
  </svg>`;
}

// ─── Empty pill ───────────────────────────────────────────────────────────────

function emptySection(msg) {
  return `<div class="ai-section-empty"><i class="bi bi-hourglass-split"></i> ${msg}</div>`;
}

// ─── Financial Health Card ────────────────────────────────────────────────────

function renderHealthCard(h) {
  if (!h.hasData) {
    return `<div class="ai-section ai-health-section" style="border-color:#e2e8f040">
      <div class="ai-sec-hd" style="background:#f1f5f9;border-bottom-color:#e2e8f0;border-left-color:#94a3b8">
        <span class="ai-sec-icon" style="background:linear-gradient(135deg,#94a3b8,#cbd5e1)"><i class="bi bi-heart-pulse-fill"></i></span>
        <span class="ai-sec-title">Financial Health Score</span>
        <span class="ai-health-badge" style="background:#f1f5f9;color:#94a3b8;border-color:#e2e8f0">—</span>
      </div>
      <div class="ai-sec-body">
        <div class="ai-health-nodata">
          <i class="bi bi-bar-chart-steps ai-health-nodata-icon"></i>
          <div class="ai-health-nodata-title">No data yet</div>
          <div class="ai-health-nodata-msg">Add expenses and income to calculate your financial health score.</div>
        </div>
      </div>
    </div>`;
  }

  const { overall, savingsScore, budgetScore, consistencyScore, label, description } = h;
  const scoreColor = overall >= 80 ? '#10b981' : overall >= 60 ? '#3b82f6' : overall >= 40 ? '#f59e0b' : '#ef4444';
  const scoreBg    = overall >= 80 ? '#f0fdf4' : overall >= 60 ? '#eff6ff' : overall >= 40 ? '#fffbeb' : '#fff5f5';

  function bar(score, color) {
    return `<div class="ai-hbar-track"><div class="ai-hbar-fill" style="width:${Math.min(100,score)}%;background:${color}"></div></div>`;
  }

  return `<div class="ai-section ai-health-section" style="border-color:${scoreColor}40">
    <div class="ai-sec-hd" style="background:${scoreBg};border-bottom-color:${scoreColor}30;border-left-color:${scoreColor}">
      <span class="ai-sec-icon" style="background:linear-gradient(135deg,${scoreColor},${scoreColor}cc)"><i class="bi bi-heart-pulse-fill"></i></span>
      <span class="ai-sec-title">Financial Health Score</span>
      <span class="ai-health-badge" style="background:${scoreColor}18;color:${scoreColor};border-color:${scoreColor}40">${label}</span>
    </div>
    <div class="ai-sec-body">
      <div class="ai-health-layout">
        <!-- Score circle -->
        <div class="ai-health-score-wrap">
          <div class="ai-health-score-ring" style="--score-color:${scoreColor};--score-pct:${overall}">
            <svg viewBox="0 0 100 100" class="ai-score-svg">
              <circle cx="50" cy="50" r="42" fill="none" stroke="#e2e8f0" stroke-width="8"/>
              <circle cx="50" cy="50" r="42" fill="none" stroke="${scoreColor}" stroke-width="8"
                stroke-linecap="round"
                stroke-dasharray="${(overall / 100) * 263.9} 263.9"
                transform="rotate(-90 50 50)"/>
            </svg>
            <div class="ai-score-inner">
              <div class="ai-score-num" style="color:${scoreColor}">${overall}</div>
              <div class="ai-score-denom">/ 100</div>
            </div>
          </div>
          <div class="ai-health-desc-wrap">
            <div class="ai-health-desc">${esc(description)}</div>
          </div>
        </div>
        <!-- Metric bars -->
        <div class="ai-health-metrics">
          <div class="ai-hmetric">
            <div class="ai-hmetric-head">
              <span class="ai-hmetric-icon" style="color:#10b981"><i class="bi bi-piggy-bank-fill"></i></span>
              <span class="ai-hmetric-label">Savings Rate</span>
              <span class="ai-hmetric-pct" style="color:#10b981">${savingsScore.toFixed(0)}%</span>
            </div>
            ${bar(savingsScore, '#10b981')}
          </div>
          <div class="ai-hmetric">
            <div class="ai-hmetric-head">
              <span class="ai-hmetric-icon" style="color:#f59e0b"><i class="bi bi-bar-chart-fill"></i></span>
              <span class="ai-hmetric-label">Budget Adherence</span>
              <span class="ai-hmetric-pct" style="color:#f59e0b">${budgetScore}%</span>
            </div>
            ${bar(budgetScore, '#f59e0b')}
          </div>
          <div class="ai-hmetric">
            <div class="ai-hmetric-head">
              <span class="ai-hmetric-icon" style="color:#3b82f6"><i class="bi bi-check2-square"></i></span>
              <span class="ai-hmetric-label">Spending Consistency</span>
              <span class="ai-hmetric-pct" style="color:#3b82f6">${consistencyScore}%</span>
            </div>
            ${bar(consistencyScore, '#3b82f6')}
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

// ─── Summary Banner ───────────────────────────────────────────────────────────

function renderBanner(mom, hasIncome) {
  const { currentTotal, previousTotal, absoluteDiff, percentChange, direction } = mom;
  const upDown = direction === 'up' ? 'up' : direction === 'down' ? 'down' : '';
  const arrow  = direction === 'up' ? 'bi-arrow-up-right' : direction === 'down' ? 'bi-arrow-down-right' : 'bi-dash';
  return `
  <div class="ai-banner">
    <div class="ai-banner-metric">
      <div class="ai-bm-icon" style="background:linear-gradient(135deg,#6366f1,#818cf8)"><i class="bi bi-calendar3"></i></div>
      <div>
        <div class="ai-bm-label">This Month</div>
        <div class="ai-bm-value">${fmt(currentTotal)}</div>
      </div>
    </div>
    <div class="ai-banner-metric">
      <div class="ai-bm-icon" style="background:linear-gradient(135deg,#64748b,#94a3b8)"><i class="bi bi-calendar-minus"></i></div>
      <div>
        <div class="ai-bm-label">Last Month</div>
        <div class="ai-bm-value">${fmt(previousTotal)}</div>
      </div>
    </div>
    <div class="ai-banner-metric" style="border-right:none">
      <div class="ai-bm-icon" style="background:linear-gradient(135deg,${upDown === 'up' ? '#ef4444,#f87171' : upDown === 'down' ? '#10b981,#34d399' : '#94a3b8,#cbd5e1'})"><i class="bi ${arrow}"></i></div>
      <div>
        <div class="ai-bm-label">Change</div>
        <div class="ai-bm-value ai-change--${upDown || 'flat'}">${fmtPct(percentChange)}</div>
        <div class="ai-bm-sub">${fmt(Math.abs(absoluteDiff))} ${absoluteDiff >= 0 ? 'more' : 'less'}</div>
      </div>
    </div>
  </div>
  ${!hasIncome ? `<div class="ai-banner-notice"><i class="bi bi-info-circle"></i> No income data — add income records to unlock savings rate insights.</div>` : ''}`;
}

// ─── Trends ───────────────────────────────────────────────────────────────────

function renderTopCategories(trends, expenses) {
  // Build this-month and last-month totals per category from raw expenses
  const now = new Date();
  const curYM  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const prev   = new Date(now.getFullYear(), now.getMonth()-1, 1);
  const prevYM = `${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,'0')}`;

  const curMap = {}, prevMap = {};
  (expenses ?? []).forEach(r => {
    const ym = String(r.date ?? '').slice(0,7);
    if (ym === curYM)  curMap[r.category]  = (curMap[r.category]  ?? 0) + (Number(r.amount) || 0);
    if (ym === prevYM) prevMap[r.category] = (prevMap[r.category] ?? 0) + (Number(r.amount) || 0);
  });

  const entries = Object.entries(curMap).sort((a,b) => b[1]-a[1]);
  if (entries.length === 0) return emptySection('No expenses this month yet.');

  const grandTotal = entries.reduce((s,[,v]) => s+v, 0);
  const top = entries.slice(0, 10);

  return `<div class="ai-topcat-list">
    ${top.map(([cat, amt], i) => {
      const pct = grandTotal > 0 ? (amt / grandTotal * 100) : 0;
      const prev = prevMap[cat] ?? 0;
      const diff = prev > 0 ? ((amt - prev) / prev * 100) : null;
      const diffHtml = diff === null
        ? `<span class="ai-topcat-new">new</span>`
        : diff > 5
        ? `<span class="ai-topcat-up"><i class="bi bi-arrow-up-short"></i>${diff.toFixed(0)}%</span>`
        : diff < -5
        ? `<span class="ai-topcat-dn"><i class="bi bi-arrow-down-short"></i>${Math.abs(diff).toFixed(0)}%</span>`
        : `<span class="ai-topcat-flat">—</span>`;
      const COLORS = ['#6366f1','#f59e0b','#10b981','#ef4444','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#f97316','#84cc16'];
      const color = COLORS[i % COLORS.length];
      return `<div class="ai-topcat-row">
        <div class="ai-topcat-rank" style="color:${color}">${i+1}</div>
        <div class="ai-topcat-info">
          <div class="ai-topcat-name">${esc(cat)}</div>
          <div class="ai-topcat-bar-wrap">
            <div class="ai-topcat-bar" style="width:${pct.toFixed(1)}%;background:${color}"></div>
          </div>
        </div>
        <div class="ai-topcat-right">
          <div class="ai-topcat-amt">${fmt(amt)}</div>
          <div class="ai-topcat-meta">${pct.toFixed(0)}% ${diffHtml}</div>
        </div>
      </div>`;
    }).join('')}
    ${entries.length > 10 ? `<div class="ai-topcat-more">+${entries.length-10} more categories</div>` : ''}
  </div>`;
}

// ─── Forecasts ────────────────────────────────────────────────────────────────

function renderForecasts(forecasts, total) {
  if (!forecasts.length) return emptySection('Need 3+ months of data per category to generate forecasts.');
  return `
  <div class="ai-grid ai-grid--forecast">
    ${forecasts.map(f => {
      const warn = f.exceedsBudget;
      const pctCls = f.pctDiff > 0 ? 'ai-pct--up' : 'ai-pct--down';
      return `<div class="ai-card ai-card--forecast${warn ? ' ai-card--warn' : ''}">
        ${warn ? `<div class="ai-warn-ribbon"><i class="bi bi-exclamation-triangle-fill"></i> Over Budget</div>` : ''}
        <div class="ai-cat-label">${esc(f.category)}</div>
        <div class="ai-forecast-num">${fmt(f.forecast)}</div>
        <div class="ai-forecast-row">
          <span class="ai-forecast-avg">avg ${fmt(f.average)}</span>
          <span class="${pctCls}">${fmtPct(f.pctDiff)}</span>
        </div>
        ${f.budgetLimit !== null ? `<div class="ai-forecast-bud">Budget: ${fmt(f.budgetLimit)}</div>` : ''}
      </div>`;
    }).join('')}
  </div>
  <div class="ai-total-row"><i class="bi bi-calculator-fill"></i> Projected total next month <strong>${fmt(total)}</strong></div>`;
}

// ─── Anomalies ────────────────────────────────────────────────────────────────

function renderAnomalies(anomalies) {
  if (!anomalies.length) return `<div class="ai-all-good"><i class="bi bi-shield-check"></i> No unusual spending detected — you're on track!</div>`;
  return `<div class="ai-anomaly-list">
    ${anomalies.map(a => `
    <div class="ai-anomaly-row">
      <div class="ai-anomaly-icon"><i class="bi bi-exclamation-triangle-fill"></i></div>
      <div class="ai-anomaly-body">
        <div class="ai-anomaly-title">${esc(a.label)}</div>
        <div class="ai-anomaly-meta">${esc(a.category)} · avg ${fmt(a.mean)}</div>
      </div>
      <div class="ai-anomaly-right">
        <div class="ai-anomaly-amt">${fmt(a.amount)}</div>
        <span class="ai-z-badge">${a.mean > 0 ? (a.amount / a.mean).toFixed(1) + '× avg' : 'High'}</span>
      </div>
    </div>`).join('')}
  </div>`;
}

// ─── Classification ───────────────────────────────────────────────────────────

function renderBudgetSection(expenses, budgets, recs, projRate) {
  const now = new Date();
  const curYM = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
  const daysPassed  = now.getDate();
  const monthPct    = daysPassed / daysInMonth;

  // Build this-month spend per category
  const spendMap = {};
  (expenses ?? []).forEach(r => {
    if (String(r.date ?? '').slice(0,7) === curYM)
      spendMap[r.category] = (spendMap[r.category] ?? 0) + (Number(r.amount) || 0);
  });

  const curMonthBudgets = (budgets ?? []).filter(b => b.month === curYM);
  const hasBudgets = curMonthBudgets.length > 0;
  const dismissed  = getDismissed();
  const visibleRecs = (recs ?? []).filter(r => !dismissed.includes(r.category) && !r.hasBudget);

  // ── Budget tracker rows ──
  const trackerHtml = hasBudgets ? (() => {
    const rows = curMonthBudgets.map(b => {
      const limit     = Number(b.monthlyLimit) || 0;
      const spent     = spendMap[b.category] ?? 0;
      const pct       = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
      const over      = limit > 0 && spent > limit;
      const onPace    = limit > 0 && !over && (spent / limit) > monthPct + 0.1;
      const remaining = Math.max(limit - spent, 0);
      return { cat: b.category, limit, spent, pct, over, onPace, remaining };
    }).sort((a, b) => { if (a.over !== b.over) return a.over ? -1 : 1; return b.pct - a.pct; });

    const overCount   = rows.filter(r => r.over).length;
    const warnCount   = rows.filter(r => !r.over && r.onPace).length;
    const okCount     = rows.filter(r => !r.over && !r.onPace).length;

    return `
    <div class="ai-btrack-summary">
      <div class="ai-btrack-pill ai-btrack-pill--over"><i class="bi bi-x-circle-fill"></i>${overCount} Over</div>
      <div class="ai-btrack-pill ai-btrack-pill--warn"><i class="bi bi-exclamation-circle-fill"></i>${warnCount} Fast</div>
      <div class="ai-btrack-pill ai-btrack-pill--ok"><i class="bi bi-check-circle-fill"></i>${okCount} OK</div>
      <span class="ai-btrack-day-note">${daysPassed}/${daysInMonth} days</span>
    </div>
    <div class="ai-btrack-list">
      ${rows.map(r => {
        const barColor    = r.over ? '#ef4444' : r.onPace ? '#f59e0b' : '#10b981';
        const statusIcon  = r.over ? 'bi-x-circle-fill' : r.onPace ? 'bi-exclamation-circle-fill' : 'bi-check-circle-fill';
        const statusColor = r.over ? '#ef4444' : r.onPace ? '#f59e0b' : '#10b981';
        return `<div class="ai-btrack-row${r.over ? ' ai-btrack-row--over' : ''}">
          <div class="ai-btrack-cat">
            <i class="bi ${statusIcon}" style="color:${statusColor};font-size:.75rem"></i>
            <span>${esc(r.cat)}</span>
          </div>
          <div class="ai-btrack-bar-wrap">
            <div class="ai-btrack-bar" style="width:${r.pct.toFixed(1)}%;background:${barColor}"></div>
            <div class="ai-btrack-pace-line" style="left:${(monthPct*100).toFixed(1)}%"></div>
          </div>
          <div class="ai-btrack-nums">
            <span class="ai-btrack-spent" style="color:${r.over ? '#ef4444' : 'inherit'}">${fmt(r.spent)}</span>
            <span class="ai-btrack-limit">/ ${fmt(r.limit)}</span>
            ${r.over
              ? `<span class="ai-btrack-tag ai-btrack-tag--over">+${fmt(r.spent - r.limit)}</span>`
              : `<span class="ai-btrack-tag ai-btrack-tag--left">${fmt(r.remaining)} left</span>`}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  })() : `<div class="ai-btrack-empty"><i class="bi bi-bar-chart-steps"></i><div>No budgets set yet. Add budgets in the Budgets section to track them here.</div></div>`;

  // ── Suggested budgets for unbudgeted categories ──
  const suggestHtml = visibleRecs.length === 0 ? '' : `
    <div class="ai-bsug-hd">
      <i class="bi bi-lightbulb-fill" style="color:#f59e0b"></i>
      Suggested budgets for untracked categories
      ${dismissed.length ? `<button class="ai-reset-btn ms-auto">Reset dismissed (${dismissed.length})</button>` : ''}
    </div>
    <div class="ai-grid ai-grid--recs">
      ${visibleRecs.map(r => `
        <div class="ai-rec-card">
          <div class="ai-rec-top">
            <span class="ai-cat-label">${esc(r.category)}</span>
            <button class="ai-dismiss-btn" data-cat="${esc(r.category)}" title="Dismiss"><i class="bi bi-x-lg"></i></button>
          </div>
          <div class="ai-rec-amount">${fmt(r.recommended)}<span class="ai-rec-unit">/mo</span></div>
          <span class="ai-rec-diff ai-rec-diff--none">Based on your avg spend</span>
        </div>`).join('')}
    </div>
    <div class="ai-bsug-proj">
      Projected savings rate if all followed: <strong class="${projRate >= 20 ? 'text-success' : 'text-warning'}">${projRate.toFixed(1)}%</strong>
    </div>`;

  return `<div class="ai-bsec-wrap">${trackerHtml}${suggestHtml}</div>`;
}

// ─── Recommendations ──────────────────────────────────────────────────────────

const AI_REC_LIMIT = 7;

function renderRecommendations(recs, projRate) {
  if (!recs.length) return emptySection('Need spending history to generate budget recommendations.');
  const dismissed = getDismissed();
  const visible = recs
    .filter(r => !dismissed.includes(r.category))
    .sort((a, b) => b.recommended - a.recommended);
  const hasMore   = visible.length > AI_REC_LIMIT;
  const extraCount = visible.length - AI_REC_LIMIT;
  return `
  <div class="ai-rec-header-row">
    <span class="ai-rec-proj">Projected savings rate if followed: <strong class="${projRate >= 20 ? 'text-success' : 'text-warning'}">${projRate.toFixed(1)}%</strong></span>
    ${dismissed.length ? `<button class="ai-reset-btn">Reset dismissed (${dismissed.length})</button>` : ''}
  </div>
  ${visible.length === 0 ? `<div class="ai-section-empty"><i class="bi bi-check2-all"></i> All recommendations dismissed.</div>` :
  `<div class="ai-grid ai-grid--recs">
    ${visible.map((r, i) => {
      const diffHtml = r.diff !== null
        ? (r.diff < 0 ? `<span class="ai-rec-diff ai-rec-diff--good">↓ ₹${Math.abs(r.diff).toFixed(0)} below current</span>`
                      : `<span class="ai-rec-diff ai-rec-diff--warn">↑ ₹${r.diff.toFixed(0)} above current</span>`)
        : `<span class="ai-rec-diff ai-rec-diff--none">No budget set yet</span>`;
      const RCOLORS = ['#6366f1','#f59e0b','#10b981','#ef4444','#3b82f6','#8b5cf6','#ec4899','#14b8a6'];
      const rColor = RCOLORS[i % RCOLORS.length];
      return `<div class="ai-rec-card${i >= AI_REC_LIMIT ? ' ai-rec-extra ai-rec-hidden' : ''}" style="border-top:3px solid ${rColor}">
        <div class="ai-rec-top">
          <span class="ai-rec-dot" style="background:${rColor}"></span>
          <span class="ai-cat-label">${esc(r.category)}</span>
          <button class="ai-dismiss-btn" data-cat="${esc(r.category)}" title="Dismiss"><i class="bi bi-x-lg"></i></button>
        </div>
        <div class="ai-rec-amount">${fmt(r.recommended)}<span class="ai-rec-unit">/mo</span></div>
        ${diffHtml}
        ${!r.hasBudget ? `<div class="ai-rec-nobud"><i class="bi bi-plus-circle"></i> No budget set</div>` : ''}
      </div>`;
    }).join('')}
  </div>
  ${hasMore ? `<button class="ai-rec-show-more" id="ai-rec-show-more" data-extra="${extraCount}">
    <i class="bi bi-chevron-down me-1"></i>Show ${extraCount} more categories
  </button>` : ''}`}`;
}

// ─── Tips ─────────────────────────────────────────────────────────────────────

function renderTips(tips) {
  if (!tips.length) return `<div class="ai-all-good"><i class="bi bi-emoji-smile-fill"></i> Your finances look healthy — keep it up!</div>`;
  return `<div class="ai-tips-list">
    ${tips.map(t => {
      const icon = t.type === 'well-done' ? 'bi-hand-thumbs-up-fill' :
                   t.type === 'savings-rate' ? 'bi-exclamation-octagon-fill' :
                   t.type === 'savings-goal' ? 'bi-piggy-bank-fill' : 'bi-eye-fill';
      return `<div class="ai-tip ai-tip--${t.type}${t.priority === 'high' ? ' ai-tip--urgent' : ''}">
        <span class="ai-tip-icon"><i class="bi ${icon}"></i></span>
        <span class="ai-tip-msg">${esc(t.message)}</span>
      </div>`;
    }).join('')}
  </div>`;
}

function renderSavingsProgress(savings) {
  if (!savings || savings.length === 0)
    return emptySection('No savings goals yet. Add goals in the Savings section.');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return `<div class="ai-sgoal-list">
    ${savings.map(g => {
      const pct      = g.targetAmount > 0 ? Math.min((g.savedAmount / g.targetAmount) * 100, 100) : 0;
      const remaining = Math.max(g.targetAmount - g.savedAmount, 0);
      const done     = g.savedAmount >= g.targetAmount;

      // Monthly needed
      let monthsLeft = null;
      let monthlyNeeded = null;
      if (g.targetDate) {
        const target = new Date(g.targetDate);
        const diff = (target.getFullYear() - today.getFullYear()) * 12 + (target.getMonth() - today.getMonth());
        monthsLeft = Math.max(diff, 0);
        monthlyNeeded = monthsLeft > 0 ? remaining / monthsLeft : remaining;
      }

      const barColor = done ? '#10b981' : pct >= 75 ? '#3b82f6' : pct >= 40 ? '#f59e0b' : '#6366f1';
      const statusBadge = done
        ? `<span class="ai-sgoal-badge ai-sgoal-badge--done"><i class="bi bi-check-circle-fill"></i> Complete</span>`
        : monthsLeft === 0 && g.targetDate
        ? `<span class="ai-sgoal-badge ai-sgoal-badge--due">Due now</span>`
        : '';

      return `<div class="ai-sgoal-row">
        <div class="ai-sgoal-top">
          <span class="ai-sgoal-name">${esc(g.name)}</span>
          ${statusBadge}
          <span class="ai-sgoal-pct" style="color:${barColor}">${pct.toFixed(0)}%</span>
        </div>
        <div class="ai-sgoal-bar-wrap">
          <div class="ai-sgoal-bar" style="width:${pct.toFixed(1)}%;background:${barColor}"></div>
        </div>
        <div class="ai-sgoal-foot">
          <span class="ai-sgoal-saved">${fmt(g.savedAmount)} <span class="ai-sgoal-of">of ${fmt(g.targetAmount)}</span></span>
          ${!done && monthlyNeeded !== null
            ? `<span class="ai-sgoal-needed">${fmt(monthlyNeeded)}/mo needed${monthsLeft !== null ? ` · ${monthsLeft}mo left` : ''}</span>`
            : done ? `<span class="ai-sgoal-needed" style="color:#10b981">Goal reached!</span>`
            : `<span class="ai-sgoal-needed">${fmt(remaining)} to go</span>`}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

// ─── Income Allocation ────────────────────────────────────────────────────────

function renderIncomeAllocation(expenses, income) {
  const { items, totalIncome, isFallback, activeMonth } = computeIncomeExpenseRatio(expenses, income);
  if (totalIncome <= 0) return null;
  if (items.length === 0) return emptySection('No expenses this month to compare against income.');

  const colorMap = { high: '#ef4444', medium: '#f59e0b', low: '#10b981' };
  const monthLabel = (() => {
    if (!activeMonth) return '';
    const [y, m] = activeMonth.split('-');
    return new Date(+y, +m - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
  })();

  const ALLOC_LIMIT = 5;
  const hasMoreAlloc  = items.length > ALLOC_LIMIT;
  const extraAlloc    = items.length - ALLOC_LIMIT;

  return `
  ${isFallback ? `<div class="ai-sparse-notice" style="margin-bottom:.75rem"><i class="bi bi-info-circle-fill"></i> No income recorded for this month yet — showing <strong>${monthLabel}</strong> data.</div>` : ''}
  <div class="ai-income-alloc-total">
    <i class="bi bi-wallet2"></i> Total income (${monthLabel}): <strong>${fmt(totalIncome)}</strong>
  </div>
  <div class="ai-income-alloc-list">
    ${items.map((item, i) => {
      const color = colorMap[item.classification];
      const barW  = Math.min(item.pct, 100).toFixed(1);
      return `<div class="ai-income-alloc-row${i >= ALLOC_LIMIT ? ' ai-alloc-extra ai-rec-hidden' : ''}">
        <div class="ai-income-alloc-cat">${esc(item.category)}</div>
        <div class="ai-income-alloc-bar-wrap">
          <div class="ai-income-alloc-bar" style="width:${barW}%;background:${color}"></div>
        </div>
        <div class="ai-income-alloc-right">
          <span class="ai-income-alloc-pct" style="color:${color}">${item.pct.toFixed(1)}%</span>
          <span class="ai-income-alloc-amt">${fmt(item.amount)}</span>
        </div>
      </div>`;
    }).join('')}
  </div>
  ${hasMoreAlloc ? `<button class="ai-rec-show-more" id="ai-alloc-show-more" data-extra="${extraAlloc}">
    <i class="bi bi-chevron-down me-1"></i>Show ${extraAlloc} more categories
  </button>` : ''}`;
}

// ─── Recurring Expense Detector ──────────────────────────────────────────────

function renderRecurringExpenses(expenses) {
  const now = new Date();
  const months = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }

  const descMap = {};
  (expenses ?? []).forEach(r => {
    const ym = String(r.date ?? '').slice(0,7);
    if (!months.includes(ym)) return;
    const label = (r.description || r.category || '').replace(/\s*\[.*?\]/g, '').trim();
    const key = label.toLowerCase();
    if (!key) return;
    if (!descMap[key]) descMap[key] = { label, category: r.category, monthTotals: {} };
    descMap[key].monthTotals[ym] = (descMap[key].monthTotals[ym] || 0) + (Number(r.amount) || 0);
  });

  const recurring = Object.values(descMap)
    .filter(d => Object.keys(d.monthTotals).length >= 2)
    .map(d => {
      const monthlyValues = Object.values(d.monthTotals);
      const avgAmount = monthlyValues.reduce((s, v) => s + v, 0) / monthlyValues.length;
      return {
        label: d.label,
        category: d.category,
        avgAmount,
        monthsCount: monthlyValues.length,
      };
    })
    .sort((a, b) => b.avgAmount - a.avgAmount)
    .slice(0, 8);

  if (recurring.length === 0) return emptySection('No recurring expenses detected yet. Need 2+ months of similar transactions.');

  const totalMonthly = recurring.reduce((s, r) => s + r.avgAmount, 0);

  return `
  <div class="ai-recur-summary">
    <i class="bi bi-arrow-repeat me-1" style="color:#8b5cf6"></i>
    <strong>${recurring.length}</strong> recurring expenses detected ·
    <strong>${fmt(Math.round(totalMonthly))}/mo</strong> fixed commitment
  </div>
  <div class="ai-recur-list">
    ${recurring.map(r => `
    <div class="ai-recur-row">
      <div class="ai-recur-icon"><i class="bi bi-arrow-repeat"></i></div>
      <div class="ai-recur-info">
        <div class="ai-recur-name">${esc(r.label)}</div>
        <div class="ai-recur-meta">${esc(r.category ?? '')} · seen ${r.monthsCount} months</div>
      </div>
      <div class="ai-recur-amt">${fmt(Math.round(r.avgAmount))}<span class="ai-recur-unit">/mo</span></div>
    </div>`).join('')}
  </div>`;
}

// ─── Smart Goal Completion Estimate ──────────────────────────────────────────

function renderGoalEstimates(savings, expenses, income) {
  if (!savings || savings.length === 0) return emptySection('No savings goals added yet.');

  const now = new Date();
  let totalNet = 0, monthCount = 0;
  // Last 6 completed months only (exclude current ongoing month)
  for (let i = 1; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const inc = (income ?? []).filter(r => String(r.date ?? '').slice(0,7) === ym).reduce((s, r) => s + (Number(r.amount)||0), 0);
    const exp = (expenses ?? []).filter(r => String(r.date ?? '').slice(0,7) === ym).reduce((s, r) => s + (Number(r.amount)||0), 0);
    if (inc > 0 || exp > 0) { totalNet += (inc - exp); monthCount++; }
  }
  // Fall back to all-time average if still no data
  if (monthCount === 0) {
    const allInc = (income ?? []).reduce((s, r) => s + (Number(r.amount)||0), 0);
    const allExp = (expenses ?? []).reduce((s, r) => s + (Number(r.amount)||0), 0);
    const allMonths = new Set([
      ...(income ?? []).map(r => String(r.date ?? '').slice(0,7)),
      ...(expenses ?? []).map(r => String(r.date ?? '').slice(0,7)),
    ].filter(Boolean));
    monthCount = allMonths.size || 1;
    totalNet = allInc - allExp;
  }
  const avgSavings = monthCount > 0 ? totalNet / monthCount : 0;
  const canEstimate = avgSavings > 0;

  const goals = savings.map(g => {
    const target    = Number(g.targetAmount) || 0;
    const saved     = Number(g.savedAmount)  || 0;
    const remaining = Math.max(target - saved, 0);
    const done      = remaining === 0;
    const months    = canEstimate && !done ? Math.ceil(remaining / avgSavings) : null;
    const estDate   = months ? new Date(now.getFullYear(), now.getMonth() + months, 1) : null;
    const pct       = target > 0 ? Math.min((saved / target) * 100, 100) : 0;
    return { name: g.name, target, saved, remaining, done, months, estDate, pct };
  }).sort((a, b) => (a.months ?? 9999) - (b.months ?? 9999));

  const noteHtml = canEstimate
    ? `<div class="ai-gest-note"><i class="bi bi-info-circle me-1"></i>Based on avg monthly savings of <strong>${fmt(Math.round(avgSavings))}</strong> (last ${monthCount} month${monthCount > 1 ? 's' : ''})</div>`
    : `<div class="ai-gest-note" style="border-color:#fde68a;background:#fffbeb;color:#92400e"><i class="bi bi-exclamation-circle me-1"></i>Record income to see estimated completion dates.</div>`;

  return `
  ${noteHtml}
  <div class="ai-gest-list">
    ${goals.map(g => {
      const color = g.done ? '#10b981' : g.pct >= 75 ? '#3b82f6' : g.pct >= 40 ? '#f59e0b' : '#8b5cf6';
      const badge = g.done ? 'Complete!' : g.months ? (g.months <= 1 ? 'Next month' : `~${g.months} months`) : `${g.pct.toFixed(0)}%`;
      const dateStr = g.estDate ? g.estDate.toLocaleString('default', { month: 'short', year: 'numeric' }) : '';
      return `<div class="ai-gest-row">
        <div class="ai-gest-top">
          <span class="ai-gest-name">${esc(g.name)}</span>
          <span class="ai-gest-badge" style="background:${color}18;color:${color}">${badge}</span>
        </div>
        <div class="ai-gest-bar-wrap">
          <div class="ai-gest-bar" style="width:${g.pct.toFixed(1)}%;background:${color}"></div>
        </div>
        <div class="ai-gest-foot">
          <span>${fmt(Math.round(g.saved))} of ${fmt(g.target)}</span>
          ${!g.done && dateStr ? `<span class="ai-gest-date"><i class="bi bi-calendar3 me-1"></i>Est. ${dateStr}</span>` : ''}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

// ─── Category Growth Trend (3-month) ─────────────────────────────────────────

function renderCategoryTrend3(expenses) {
  const now = new Date();
  const months = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }

  const catMonths = {};
  (expenses ?? []).forEach(r => {
    const ym  = String(r.date ?? '').slice(0,7);
    const idx = months.indexOf(ym);
    if (idx === -1 || !r.category) return;
    if (!catMonths[r.category]) catMonths[r.category] = [0, 0, 0];
    catMonths[r.category][idx] += Number(r.amount) || 0;
  });

  const trends = Object.entries(catMonths)
    .filter(([, vals]) => vals.filter(v => v > 0).length >= 2)
    .map(([cat, vals]) => {
      const nonZero = vals.filter(v => v > 0);
      const avg   = nonZero.reduce((s, v) => s + v, 0) / nonZero.length;
      const first = vals.find(v => v > 0) || 0;
      const last  = [...vals].reverse().find(v => v > 0) || 0;
      const change = first > 0 ? ((last - first) / first) * 100 : 0;
      const dir   = change > 8 ? 'up' : change < -8 ? 'down' : 'stable';
      return { cat, vals, avg, change, dir };
    })
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 8);

  if (trends.length === 0) return emptySection('Need 2+ months of data to show category trends.');

  const mLabels = months.map(ym => {
    const [y, m] = ym.split('-');
    return new Date(+y, +m - 1, 1).toLocaleString('default', { month: 'short' });
  });

  return `
  <div class="ai-trend3-hd">
    <span class="ai-trend3-hd-cat">Category</span>
    <div class="ai-trend3-hd-months">
      ${mLabels.map(l => `<span>${l}</span>`).join('')}
    </div>
    <span class="ai-trend3-hd-trend">Trend</span>
    <span class="ai-trend3-hd-avg">Avg/mo</span>
  </div>
  <div class="ai-trend3-list">
    ${trends.map(t => {
      const dirColor = t.dir === 'up' ? '#ef4444' : t.dir === 'down' ? '#10b981' : '#94a3b8';
      const dirIcon  = t.dir === 'up' ? 'bi-trending-up' : t.dir === 'down' ? 'bi-trending-down' : 'bi-dash';
      const dirLabel = t.dir === 'stable' ? 'Stable' : Math.abs(t.change).toFixed(0) + '%';
      const maxVal   = Math.max(...t.vals) || 1;
      return `<div class="ai-trend3-row">
        <div class="ai-trend3-cat">${esc(t.cat)}</div>
        <div class="ai-trend3-bars">
          ${t.vals.map((v, i) => {
            const h = v > 0 ? Math.max(Math.round((v / maxVal) * 32), 6) : 3;
            const isLast = i === 2;
            const bg = isLast ? dirColor : '#e2e8f0';
            return `<div class="ai-trend3-bar-col">
              <div class="ai-trend3-bar" style="height:${h}px;background:${bg}" title="${mLabels[i]}: ${v > 0 ? fmt(Math.round(v)) : '—'}"></div>
            </div>`;
          }).join('')}
        </div>
        <div class="ai-trend3-dir" style="color:${dirColor}">
          <i class="bi ${dirIcon}"></i><span>${dirLabel}</span>
        </div>
        <div class="ai-trend3-avg">${fmt(Math.round(t.avg))}</div>
      </div>`;
    }).join('')}
  </div>`;
}

// ─── Year-over-Year Comparison ───────────────────────────────────────────────

function renderYearOverYear(expenses) {
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  const curYM  = `${curY}-${String(curM).padStart(2,'0')}`;
  const lastYM = `${curY-1}-${String(curM).padStart(2,'0')}`;
  const monthLabel = now.toLocaleString('default', { month: 'long' });

  const curTotal  = (expenses ?? []).filter(r => String(r.date ?? '').slice(0,7) === curYM)
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const lastTotal = (expenses ?? []).filter(r => String(r.date ?? '').slice(0,7) === lastYM)
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);

  if (lastTotal === 0) return null;

  const diff = curTotal - lastTotal;
  const pctChange = (diff / lastTotal) * 100;
  const isUp = diff > 0;
  const maxVal = Math.max(curTotal, lastTotal) || 1;
  const curPct  = Math.round((curTotal  / maxVal) * 100);
  const lastPct = Math.round((lastTotal / maxVal) * 100);
  const changeColor = isUp ? '#ef4444' : '#10b981';
  const changeIcon  = isUp ? 'bi-arrow-up-right' : 'bi-arrow-down-right';

  return `
  <div class="ai-yoy-wrap">
    <div class="ai-yoy-row">
      <div class="ai-yoy-col">
        <div class="ai-yoy-year">${curY} <span class="ai-yoy-badge ai-yoy-badge--cur">This Year</span></div>
        <div class="ai-yoy-amt">${fmt(Math.round(curTotal))}</div>
        <div class="ai-yoy-bar-wrap"><div class="ai-yoy-bar ai-yoy-bar--cur" style="width:${curPct}%"></div></div>
      </div>
      <div class="ai-yoy-divider">
        <div class="ai-yoy-change" style="color:${changeColor}"><i class="bi ${changeIcon}"></i>${Math.abs(pctChange).toFixed(1)}%</div>
        <div class="ai-yoy-vs">vs</div>
      </div>
      <div class="ai-yoy-col ai-yoy-col--last">
        <div class="ai-yoy-year">${curY-1} <span class="ai-yoy-badge">Last Year</span></div>
        <div class="ai-yoy-amt">${fmt(Math.round(lastTotal))}</div>
        <div class="ai-yoy-bar-wrap"><div class="ai-yoy-bar ai-yoy-bar--last" style="width:${lastPct}%"></div></div>
      </div>
    </div>
    <div class="ai-yoy-summary">
      <i class="bi ${changeIcon} me-1" style="color:${changeColor}"></i>
      ${isUp
        ? `Spending <strong style="color:${changeColor}">${fmt(Math.abs(Math.round(diff)))} more</strong> in ${monthLabel} this year vs last year.`
        : `Spending <strong style="color:${changeColor}">${fmt(Math.abs(Math.round(diff)))} less</strong> in ${monthLabel} this year — great improvement!`}
    </div>
  </div>`;
}

// ─── What If Tip ──────────────────────────────────────────────────────────────

function renderWhatIf(expenses) {
  const now = new Date();
  const curYM = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

  const catMap = {};
  (expenses ?? []).filter(r => String(r.date ?? '').slice(0,7) === curYM).forEach(r => {
    catMap[r.category] = (catMap[r.category] ?? 0) + (Number(r.amount) || 0);
  });

  // Filter to only Discretionary categories — skip Rent, EMI, Loan, Insurance etc.
  const entries = Object.entries(catMap)
    .filter(([cat]) => classifyCategory(cat) === 'Discretionary')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (entries.length === 0) return emptySection('No discretionary spending this month to suggest reductions for.');

  const totalSave20mo  = entries.reduce((s, [, amt]) => s + Math.round(amt * 0.2), 0);
  const totalSave20yr  = totalSave20mo * 12;

  const COLORS = ['#6366f1','#f59e0b','#10b981','#ef4444','#ec4899'];

  return `
  <div class="ai-whatif-wrap">
    <div class="ai-whatif-summary">
      <i class="bi bi-stars me-2" style="color:#8b5cf6"></i>
      Cutting these 5 categories by 20% saves
      <strong style="color:#10b981">${fmt(totalSave20mo)}/mo</strong> →
      <strong style="color:#10b981">${fmt(totalSave20yr)}/yr</strong>
    </div>
    <div class="ai-whatif-list">
      ${entries.map(([cat, amt], i) => {
        const save = Math.round(amt * 0.2);
        const pct  = Math.round((amt * 0.2) / amt * 100);
        return `<div class="ai-whatif-row">
          <div class="ai-whatif-rank" style="color:${COLORS[i]}">${i+1}</div>
          <div class="ai-whatif-info">
            <div class="ai-whatif-cat">${esc(cat)}</div>
            <div class="ai-whatif-bar-wrap">
              <div class="ai-whatif-bar" style="width:${Math.min((amt/entries[0][1])*100,100).toFixed(1)}%;background:${COLORS[i]}"></div>
            </div>
          </div>
          <div class="ai-whatif-nums">
            <div class="ai-whatif-current">${fmt(amt)}/mo</div>
            <div class="ai-whatif-saving" style="color:${COLORS[i]}">−20% → <strong>${fmt(save)}/mo</strong></div>
            <div class="ai-whatif-yr">= ${fmt(save*12)}/yr</div>
          </div>
        </div>`;
      }).join('')}
    </div>
    <div class="ai-whatif-note"><i class="bi bi-info-circle me-1"></i>Fixed costs (Rent, EMI, Loans, Investments, SIP) excluded — only reducible categories shown.</div>
  </div>`;
}

// ─── Spending Velocity ────────────────────────────────────────────────────────

function renderSpendingVelocity(expenses, income) {
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const curYM = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const daysLeft = daysInMonth - dayOfMonth;

  const spent = (expenses ?? [])
    .filter(r => String(r.date ?? '').slice(0,7) === curYM)
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const monthIncome = (income ?? [])
    .filter(r => String(r.date ?? '').slice(0,7) === curYM)
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);

  const timePct  = Math.round((dayOfMonth / daysInMonth) * 100);
  const moneyPct = monthIncome > 0 ? Math.min(Math.round((spent / monthIncome) * 100), 100) : 0;
  const dailyAvg = dayOfMonth > 0 ? spent / dayOfMonth : 0;
  const projected = Math.round(dailyAvg * daysInMonth);
  const dailyBudget = daysLeft > 0 && monthIncome > 0 ? (monthIncome - spent) / daysLeft : 0;

  const gap = monthIncome > 0 ? moneyPct - timePct : 0;
  const status = monthIncome === 0 ? 'neutral' : gap > 15 ? 'danger' : gap > 5 ? 'warning' : 'ok';
  const statusColor = status === 'danger' ? '#ef4444' : status === 'warning' ? '#f59e0b' : status === 'ok' ? '#10b981' : '#a78bfa';
  const statusLabel = status === 'danger' ? 'Spending Fast' : status === 'warning' ? 'Slightly Ahead' : status === 'ok' ? 'On Track' : 'Tracking';
  const statusIcon  = status === 'danger' ? 'bi-exclamation-triangle-fill' : status === 'warning' ? 'bi-exclamation-circle-fill' : status === 'ok' ? 'bi-check-circle-fill' : 'bi-activity';

  return `
  <div class="ai-velocity-card">
    <div class="ai-velocity-top">
      <div class="ai-velocity-title"><i class="bi bi-speedometer2 me-2"></i>Spending Velocity</div>
      <span class="ai-velocity-badge" style="background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}40">
        <i class="bi ${statusIcon} me-1"></i>${statusLabel}
      </span>
    </div>
    <div class="ai-velocity-meta">
      <span><strong>${fmt(Math.round(spent))}</strong> spent</span>
      <span class="ai-vel-dot">·</span>
      <span>Day <strong>${dayOfMonth}</strong> of ${daysInMonth}</span>
      <span class="ai-vel-dot">·</span>
      <span><strong>${fmt(Math.round(dailyAvg))}</strong>/day avg</span>
    </div>
    <div class="ai-velocity-gauges">
      <div class="ai-vel-row">
        <span class="ai-vel-lbl">Time elapsed</span>
        <div class="ai-vel-track"><div class="ai-vel-fill" style="width:${timePct}%;background:#818cf8"></div></div>
        <span class="ai-vel-pct">${timePct}%</span>
      </div>
      <div class="ai-vel-row">
        <span class="ai-vel-lbl">Income spent</span>
        <div class="ai-vel-track"><div class="ai-vel-fill" style="width:${moneyPct}%;background:${statusColor}"></div></div>
        <span class="ai-vel-pct" style="color:${statusColor}">${monthIncome > 0 ? moneyPct + '%' : '—'}</span>
      </div>
    </div>
    <div class="ai-velocity-foot">
      ${dailyBudget > 0 ? `<span><i class="bi bi-wallet2 me-1" style="color:#34d399"></i>${fmt(Math.round(dailyBudget))}/day remaining</span>` : ''}
      <span><i class="bi bi-graph-up me-1" style="color:#a5b4fc"></i>Projected this month: <strong>${fmt(projected)}</strong></span>
    </div>
  </div>`;
}

// ─── Daily Spending Day Tiers ──────────────────────────────────────────────

function renderSpendingDayTiers(expenses, income) {
  const { tiers, dailyBudget, monthlyIncome, totalDays, longestZeroStreak, hasIncome } = computeSpendingDayTiers(expenses, income);

  const zeroTier    = tiers.find(t => t.key === 'zero');
  const splurgeTier = tiers.find(t => t.key === 'splurge');
  const dominant    = tiers.filter(t => t.key !== 'zero' && t.total > 0).sort((a, b) => b.total - a.total)[0];

  const narratives = [];
  if (zeroTier.total > 0) {
    const star = zeroTier.total >= 10 ? '🏆' : zeroTier.total >= 5 ? '⭐' : '✅';
    narratives.push(`${star} <strong>${zeroTier.total} zero-spend day${zeroTier.total > 1 ? 's' : ''}</strong> this month${zeroTier.total >= 5 ? ' — excellent discipline!' : '!'}`);
  }
  if (longestZeroStreak >= 3) {
    narratives.push(`🔥 Longest zero-spend streak: <strong>${longestZeroStreak} consecutive days</strong>`);
  }
  if (splurgeTier.total > 0) {
    narratives.push(`⚠️ <strong>${splurgeTier.total} splurge day${splurgeTier.total > 1 ? 's' : ''}</strong> where you exceeded daily budget by 20%+`);
  }
  if (dominant) {
    narratives.push(`📊 Most common level this month: <strong>${dominant.label}</strong> (${dominant.total} days)`);
  }

  const wdTotal     = tiers.reduce((s, t) => s + t.weekdays, 0);
  const weTotal     = tiers.reduce((s, t) => s + t.weekends, 0);
  const wdSpendDays = tiers.filter(t => t.key !== 'zero').reduce((s, t) => s + t.weekdays, 0);
  const weSpendDays = tiers.filter(t => t.key !== 'zero').reduce((s, t) => s + t.weekends, 0);
  const wdPct = wdTotal > 0 ? Math.round((wdSpendDays / wdTotal) * 100) : 0;
  const wePct = weTotal > 0 ? Math.round((weSpendDays / weTotal) * 100) : 0;

  const incomeNote = hasIncome
    ? `Your daily budget ≈ <strong>${fmt(Math.round(dailyBudget))}</strong> (${fmt(Math.round(monthlyIncome))}/mo ÷ days). Tiers use fixed ₹ brackets — universal and easy to read.`
    : `Tiers use fixed ₹ brackets everyone understands. Add monthly income to also see your daily budget here.`;

  return `
  <div class="sdt-ai-wrap">
    <div class="sdt-ai-note"><i class="bi bi-info-circle-fill me-1"></i>${incomeNote}</div>
    <div class="sdt-ai-grid">
      ${tiers.map(t => `
        <div class="sdt-ai-tile" style="border-color:${t.color}33;background:${t.color}0d">
          <div class="sdt-ai-tile-emoji">${t.emoji}</div>
          <div class="sdt-ai-tile-count" style="color:${t.color}">${t.total}</div>
          <div class="sdt-ai-tile-label">${t.label}</div>
          <div class="sdt-ai-tile-range">${t.range}</div>
          <div class="sdt-ai-tile-split">
            <span title="Weekdays"><i class="bi bi-briefcase-fill"></i>${t.weekdays}</span>
            <span title="Weekends"><i class="bi bi-house-heart-fill"></i>${t.weekends}</span>
          </div>
        </div>`).join('')}
    </div>
    ${narratives.length ? `
    <div class="sdt-ai-insights">
      ${narratives.map(n => `<div class="sdt-ai-insight-item">${n}</div>`).join('')}
    </div>` : ''}
    <div class="sdt-ai-compare">
      <div class="sdt-ai-compare-title">Weekday vs Weekend Spending Rate</div>
      <div class="sdt-ai-compare-row">
        <span class="sdt-ai-compare-lbl"><i class="bi bi-briefcase me-1" style="color:#6366f1"></i>Weekdays</span>
        <div class="sdt-ai-compare-bar-wrap"><div class="sdt-ai-compare-bar" style="width:${wdPct}%;background:#6366f1"></div></div>
        <span class="sdt-ai-compare-stat">${wdSpendDays}/${wdTotal} (${wdPct}%)</span>
      </div>
      <div class="sdt-ai-compare-row">
        <span class="sdt-ai-compare-lbl"><i class="bi bi-sun me-1" style="color:#f59e0b"></i>Weekends</span>
        <div class="sdt-ai-compare-bar-wrap"><div class="sdt-ai-compare-bar" style="width:${wePct}%;background:#f59e0b"></div></div>
        <span class="sdt-ai-compare-stat">${weSpendDays}/${weTotal} (${wePct}%)</span>
      </div>
    </div>
  </div>`;
}

// ─── Day of Week Pattern ──────────────────────────────────────────────────────

function renderDayOfWeekPattern(expenses) {
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const totals = [0,0,0,0,0,0,0];

  (expenses ?? []).forEach(r => {
    if (!r.date) return;
    const d = new Date(r.date + 'T12:00:00');
    if (isNaN(d.getTime())) return;
    totals[d.getDay()] += Number(r.amount) || 0;
  });

  if (totals.every(t => t === 0)) return emptySection('Not enough data to show day-of-week pattern.');

  const max = Math.max(...totals) || 1;
  const peakIdx = totals.indexOf(max);

  const DOW_COLORS = ['#f97316','#3b82f6','#14b8a6','#8b5cf6','#6366f1','#10b981','#ec4899'];
  const peakColor = DOW_COLORS[peakIdx];

  return `
  <div class="ai-dow-wrap">
    <div class="ai-dow-insight">
      <i class="bi bi-calendar-event-fill me-1" style="color:${peakColor}"></i>
      You spend the most on <strong style="color:${peakColor}">${days[peakIdx]}s</strong> — ${fmt(Math.round(totals[peakIdx]))} total across all time
    </div>
    <div class="ai-dow-chart">
      ${totals.map((t, i) => {
        const heightPct = Math.max(Math.round((t / max) * 100), 4);
        const isPeak = i === peakIdx;
        const color = DOW_COLORS[i];
        const bg = isPeak
          ? `linear-gradient(180deg,${color},${color}bb)`
          : `${color}45`;
        const shadow = isPeak ? `;box-shadow:0 6px 16px ${color}55` : '';
        const k = t >= 1000 ? (t / 1000).toFixed(1) + 'k' : t > 0 ? Math.round(t).toString() : '—';
        return `<div class="ai-dow-col">
          <div class="ai-dow-bar-wrap">
            <div class="ai-dow-bar" style="height:${heightPct}%;background:${bg}${shadow}"></div>
          </div>
          <div class="ai-dow-day${isPeak ? ' ai-dow-day--peak' : ''}" style="color:${isPeak ? color : color + 'bb'}">${days[i]}</div>
          <div class="ai-dow-amt${isPeak ? ' ai-dow-amt--peak' : ''}" style="color:${isPeak ? color : color + '99'}">${k}</div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

// ─── Biggest Transactions ─────────────────────────────────────────────────────

function renderBiggestTransactions(expenses) {
  const now = new Date();
  const curYM = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const thisMonth = (expenses ?? []).filter(r => String(r.date ?? '').slice(0,7) === curYM);

  // Group by description + category — sum amounts, keep earliest date
  const grouped = {};
  thisMonth.forEach(r => {
    const desc = (r.description || r.category || 'Expense').replace(/\s*\[.*?\]/g, '').trim();
    const key = `${desc.toLowerCase()}||${(r.category ?? '').toLowerCase()}`;
    if (!grouped[key]) grouped[key] = { desc, category: r.category, amount: 0, date: r.date };
    grouped[key].amount += Number(r.amount) || 0;
  });

  const top = Object.values(grouped)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  if (top.length === 0) return emptySection('No transactions this month yet.');

  const COLORS = ['#ef4444','#f59e0b','#6366f1','#10b981','#3b82f6'];

  return `<div class="ai-bigtxn-list">
    ${top.map((t, i) => {
      const dateStr = t.date ? new Date(t.date + 'T12:00:00').toLocaleDateString('en-IN', { day:'numeric', month:'short' }) : '';
      return `<div class="ai-bigtxn-row">
        <div class="ai-bigtxn-rank" style="background:${COLORS[i]}18;color:${COLORS[i]}">${i+1}</div>
        <div class="ai-bigtxn-info">
          <div class="ai-bigtxn-desc">${esc(t.desc)}</div>
          <div class="ai-bigtxn-meta">${esc(t.category ?? '')}${dateStr ? ' · ' + dateStr : ''}</div>
        </div>
        <div class="ai-bigtxn-amt" style="color:${COLORS[i]}">${fmt(Math.round(t.amount))}</div>
      </div>`;
    }).join('')}
  </div>`;
}

// ─── Main render ──────────────────────────────────────────────────────────────

export function render() {
  const container = document.getElementById('tab-ai-insights');
  if (!container) return;

  const expenses = store.get('expenses') ?? [];
  const income   = store.get('income')   ?? [];
  const budgets  = store.get('budgets')  ?? [];
  const savings  = store.get('savings')  ?? [];

  const r = computeAll(expenses, income, budgets, savings);

  const sparseNotice = r.insufficientReasons.length
    ? `<div class="ai-sparse-notice"><i class="bi bi-info-circle-fill"></i> ${r.insufficientReasons.map(x => esc(x)).join(' ')}</div>`
    : '';

  container.innerHTML = `
  <div class="ai-page">

    <!-- Page header -->
    <div class="ai-page-header">
      <div class="ai-page-header-left">
        <div class="ai-page-title">
          <span class="ai-page-title-icon"><i class="bi bi-stars"></i></span>
          AI Insights
        </div>
        <div class="ai-page-subtitle"><i class="bi bi-cpu me-1"></i>Predictive analysis &middot; Anomaly detection &middot; Spending intelligence</div>
      </div>
      <div class="ai-page-header-right">
        <span class="ai-last-updated"><i class="bi bi-clock"></i> Updated ${fmtTime(r.lastUpdated)}</span>
        <button class="ai-refresh-btn" id="ai-refresh-btn">
          <i class="bi bi-arrow-clockwise"></i> Refresh
        </button>
      </div>
    </div>

    ${renderSpendingVelocity(expenses, income)}
    ${sparseNotice}

    <div class="ai-sections">

      <!-- 1. Overall grade -->
      ${renderHealthCard(r.health)}

      <!-- 2. Alerts: anomalies + biggest transactions -->
      <div class="ai-two-col">
        <div class="ai-section">
          <div class="ai-sec-hd" style="border-left-color:#ef4444">
            <span class="ai-sec-icon" style="background:linear-gradient(135deg,#ef4444,#f87171)"><i class="bi bi-exclamation-circle-fill"></i></span>
            <span class="ai-sec-title">Unusual Spending</span>
          </div>
          <div class="ai-sec-body">${renderAnomalies(r.anomalies)}</div>
        </div>
        <div class="ai-section">
          <div class="ai-sec-hd" style="border-left-color:#6366f1">
            <span class="ai-sec-icon" style="background:linear-gradient(135deg,#6366f1,#818cf8)"><i class="bi bi-fire"></i></span>
            <span class="ai-sec-title">Biggest Transactions</span>
            <span class="ai-sec-sub">This month</span>
          </div>
          <div class="ai-sec-body">${renderBiggestTransactions(expenses)}</div>
        </div>
      </div>

      <!-- 3. Immediate savings opportunity -->
      <div class="ai-section">
        <div class="ai-sec-hd" style="border-left-color:#8b5cf6">
          <span class="ai-sec-icon" style="background:linear-gradient(135deg,#8b5cf6,#a78bfa)"><i class="bi bi-stars"></i></span>
          <span class="ai-sec-title">What If?</span>
          <span class="ai-sec-sub">Potential savings if you reduce top categories</span>
        </div>
        <div class="ai-sec-body">${renderWhatIf(expenses)}</div>
      </div>

      <!-- 4. Forward-looking forecast -->
      <div class="ai-section">
        <div class="ai-sec-hd" style="border-left-color:#f59e0b">
          <span class="ai-sec-icon" style="background:linear-gradient(135deg,#f59e0b,#fbbf24)"><i class="bi bi-calendar-check-fill"></i></span>
          <span class="ai-sec-title">Next Month Forecast</span>
          <span class="ai-sec-sub">Predicted spend per category</span>
        </div>
        <div class="ai-sec-body">${renderForecasts(r.forecasts, r.totalForecast)}</div>
      </div>

      <!-- 5. Goals progress + estimates -->
      <div class="ai-section">
        <div class="ai-sec-hd" style="border-left-color:#10b981">
          <span class="ai-sec-icon" style="background:linear-gradient(135deg,#10b981,#34d399)"><i class="bi bi-trophy-fill"></i></span>
          <span class="ai-sec-title">Goal Completion Estimates</span>
          <span class="ai-sec-sub">When will you reach each goal at your current pace?</span>
        </div>
        <div class="ai-sec-body">${renderGoalEstimates(savings, expenses, income)}</div>
      </div>

      <!-- 6. Budget action items -->
      <div class="ai-section">
        <div class="ai-sec-hd" style="border-left-color:#8b5cf6">
          <span class="ai-sec-icon" style="background:linear-gradient(135deg,#8b5cf6,#a78bfa)"><i class="bi bi-lightbulb-fill"></i></span>
          <span class="ai-sec-title">Budget Recommendations</span>
          <span class="ai-sec-sub">Suggested limits for untracked categories</span>
        </div>
        <div class="ai-sec-body">${renderRecommendations(r.recommendations, r.projectedSavingsRate)}</div>
      </div>

      <!-- 7. Pattern analysis: trends + recurring -->
      <div class="ai-two-col">
        <div class="ai-section">
          <div class="ai-sec-hd" style="border-left-color:#0ea5e9">
            <span class="ai-sec-icon" style="background:linear-gradient(135deg,#0ea5e9,#38bdf8)"><i class="bi bi-graph-up-arrow"></i></span>
            <span class="ai-sec-title">Category Trends</span>
            <span class="ai-sec-sub">3-month growth or decline</span>
          </div>
          <div class="ai-sec-body">${renderCategoryTrend3(expenses)}</div>
        </div>
        <div class="ai-section">
          <div class="ai-sec-hd" style="border-left-color:#10b981">
            <span class="ai-sec-icon" style="background:linear-gradient(135deg,#10b981,#34d399)"><i class="bi bi-arrow-repeat"></i></span>
            <span class="ai-sec-title">Recurring Expenses</span>
            <span class="ai-sec-sub">Auto-detected fixed monthly costs</span>
          </div>
          <div class="ai-sec-body">${renderRecurringExpenses(expenses)}</div>
        </div>
      </div>

      <!-- 8. Daily spending day profile -->
      <div class="ai-section">
        <div class="ai-sec-hd" style="border-left-color:#10b981">
          <span class="ai-sec-icon" style="background:linear-gradient(135deg,#10b981,#34d399)"><i class="bi bi-calendar2-range-fill"></i></span>
          <span class="ai-sec-title">Daily Spending Profile</span>
          <span class="ai-sec-sub">How many days were Zero / Minimal / Light / Moderate / Heavy / Splurge</span>
        </div>
        <div class="ai-sec-body">${renderSpendingDayTiers(expenses, income)}</div>
      </div>

      <!-- 9. Day of week habit -->
      <div class="ai-section">
        <div class="ai-sec-hd" style="border-left-color:#8b5cf6">
          <span class="ai-sec-icon" style="background:linear-gradient(135deg,#8b5cf6,#a78bfa)"><i class="bi bi-calendar-week-fill"></i></span>
          <span class="ai-sec-title">Spending by Day of Week</span>
          <span class="ai-sec-sub">All-time pattern</span>
        </div>
        <div class="ai-sec-body">${renderDayOfWeekPattern(expenses)}</div>
      </div>

      <!-- 9. Historical: year-over-year (conditional) -->
      ${(() => {
        const yoyHtml = renderYearOverYear(expenses);
        if (!yoyHtml) return '';
        return `<div class="ai-section">
          <div class="ai-sec-hd" style="border-left-color:#0ea5e9">
            <span class="ai-sec-icon" style="background:linear-gradient(135deg,#0ea5e9,#38bdf8)"><i class="bi bi-arrow-left-right"></i></span>
            <span class="ai-sec-title">Year-over-Year</span>
            <span class="ai-sec-sub">Same month last year vs this year</span>
          </div>
          <div class="ai-sec-body">${yoyHtml}</div>
        </div>`;
      })()}

      <!-- 10. Deep analysis: income allocation (conditional) -->
      ${(() => {
        const allocHtml = renderIncomeAllocation(expenses, income);
        if (!allocHtml) return '';
        return `<div class="ai-section">
          <div class="ai-sec-hd" style="border-left-color:#3b82f6">
            <span class="ai-sec-icon" style="background:linear-gradient(135deg,#3b82f6,#60a5fa)"><i class="bi bi-pie-chart-fill"></i></span>
            <span class="ai-sec-title">Income Allocation by Category</span>
            <span class="ai-sec-sub">% of income spent per category this month</span>
          </div>
          <div class="ai-sec-body">${allocHtml}</div>
        </div>`;
      })()}

      <div class="ai-section">
        <div class="ai-sec-hd" style="border-left-color:#10b981">
          <span class="ai-sec-icon" style="background:linear-gradient(135deg,#10b981,#34d399)"><i class="bi bi-hand-thumbs-up-fill"></i></span>
          <span class="ai-sec-title">Personalised Tips</span>
        </div>
        <div class="ai-sec-body">${renderTips(r.tips)}</div>
      </div>

    </div>

  </div>`;

  // Draw sparklines (both sizes)
  container.querySelectorAll('canvas.ai-spark, canvas.ai-spark-sm').forEach(c => {
    try { drawSparkline(c, JSON.parse(c.dataset.vals ?? '[]'), c.dataset.dir ?? 'Stable'); } catch { /* ignore */ }
  });

  // Dismiss buttons
  container.querySelectorAll('[data-cat]').forEach(btn => {
    btn.addEventListener('click', () => dismissRecommendation(btn.dataset.cat));
  });

  const resetBtn = container.querySelector('.ai-reset-btn');
  if (resetBtn) resetBtn.addEventListener('click', resetDismissed);

  const refreshBtn = container.querySelector('#ai-refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', render);

  const showMoreBtn = container.querySelector('#ai-rec-show-more');
  if (showMoreBtn) {
    showMoreBtn.addEventListener('click', () => {
      const extras   = container.querySelectorAll('.ai-rec-extra');
      const expanded = showMoreBtn.dataset.expanded === 'true';
      extras.forEach(el => el.classList.toggle('ai-rec-hidden', expanded));
      showMoreBtn.dataset.expanded = expanded ? 'false' : 'true';
      const count = showMoreBtn.dataset.extra;
      showMoreBtn.innerHTML = expanded
        ? `<i class="bi bi-chevron-down me-1"></i>Show ${count} more categories`
        : `<i class="bi bi-chevron-up me-1"></i>Show fewer`;
    });
  }

  const allocShowMore = container.querySelector('#ai-alloc-show-more');
  if (allocShowMore) {
    allocShowMore.addEventListener('click', () => {
      const extras   = container.querySelectorAll('.ai-alloc-extra');
      const expanded = allocShowMore.dataset.expanded === 'true';
      extras.forEach(el => el.classList.toggle('ai-rec-hidden', expanded));
      allocShowMore.dataset.expanded = expanded ? 'false' : 'true';
      const count = allocShowMore.dataset.extra;
      allocShowMore.innerHTML = expanded
        ? `<i class="bi bi-chevron-down me-1"></i>Show ${count} more categories`
        : `<i class="bi bi-chevron-up me-1"></i>Show fewer`;
    });
  }
}

// ─── init ─────────────────────────────────────────────────────────────────────

let _aiReady = false;

export function markReady() { _aiReady = true; }

export function init() {
  let _timer = null;
  function _onChange() {
    if (!_aiReady) return;
    clearTimeout(_timer);
    _timer = setTimeout(render, 150);
  }
  ['expenses', 'income', 'budgets', 'savings'].forEach(k => store.on(k, _onChange));

  const pane = document.getElementById('tab-ai-insights');
  if (pane) {
    new MutationObserver(() => {
      if (pane.classList.contains('active') && _aiReady) render();
    }).observe(pane, { attributes: true, attributeFilter: ['class'] });
  }
}
