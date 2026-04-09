// js/vehicles.js

import { CONFIG } from './config.js';
import { appendRow, fetchRows, writeAllRows } from './api.js';
import * as store from './store.js';
import { requireFields } from './validation.js';
import { formatCurrency, formatDate, populatePaymentSelect, bindDependentPaymentSelect, restorePaymentSelects } from './utils.js';
import { serialize as serializeExpense } from './expenses.js';
import { createPaginator } from './paginate.js';
import { epConfirm } from './confirm.js';

// Vehicle type icons mapping
const VEHICLE_ICONS = { 
  Bike: 'bi-bicycle', 
  Car: 'bi-car-front-fill', 
  Scooter: 'bi-scooter', 
  Truck: 'bi-truck', 
  default: 'bi-car-front-fill' 
};

export function serializeVehicle(r) { return [r.id, r.name, r.type, r.regNumber ?? '']; }
export function deserializeVehicle(row) { return { id: row[0]??'', name: row[1]??'', type: row[2]??'', regNumber: row[3]??'' }; }
export function serializeTripLog(r) { return [r.id, r.vehicleName??'', r.date, String(r.odoReading), String(r.fuelCost??0), String(r.fuelLitres??0), r.purpose, String(r.pricePerLitre??0)]; }
export function deserializeTripLog(row) { return { id: row[0]??'', vehicleName: row[1]??'', date: row[2]??'', odoReading: parseFloat(row[3])||0, fuelCost: parseFloat(row[4])||0, fuelLitres: parseFloat(row[5])||0, purpose: row[6]??'', pricePerLitre: parseFloat(row[7])||0 }; }
export function serializeVehicleExpense(r) { return [r.id, r.vehicleName??'', r.date, r.expenseType??'', String(r.amount), r.paymentMethod??'', r.description??'']; }
export function deserializeVehicleExpense(row) { return { id: row[0]??'', vehicleName: row[1]??'', date: row[2]??'', expenseType: row[3]??'', amount: parseFloat(row[4])||0, paymentMethod: row[5]??'', description: row[6]??'' }; }
export function serializeMaintenance(r) { return [r.id, r.vehicleName??'', r.type??'', r.date??'', String(r.odoReading??0), String(r.intervalKm??0), String(r.intervalDays??0), r.notes??'']; }
export function deserializeMaintenance(row) { return { id: row[0]??'', vehicleName: row[1]??'', type: row[2]??'', date: row[3]??'', odoReading: parseFloat(row[4])||0, intervalKm: parseFloat(row[5])||0, intervalDays: parseFloat(row[6])||0, notes: row[7]??'' }; }
export function serializeInsurance(r) { return [r.id??'', r.vehicleName??'', r.policyType??'', r.provider??'', r.policyNumber??'', r.expiryDate??'', String(r.premiumAmount??'')]; }
export function deserializeInsurance(row) { return { id: row[0]??'', vehicleName: row[1]??'', policyType: row[2]??'', provider: row[3]??'', policyNumber: row[4]??'', expiryDate: row[5]??'', premiumAmount: parseFloat(row[6])||0 }; }
export function serializeVehicleDoc(r) { return [r.vehicleName, r.insuranceExpiry ?? '', r.rcExpiry ?? '']; }
export function deserializeVehicleDoc(row) { return { vehicleName: row[0]??'', insuranceExpiry: row[1]??'', rcExpiry: row[2]??'' }; }

function escapeHtml(str) { return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function showError(id, msg) { const el = document.getElementById(id); if (el) { el.textContent = msg; el.classList.remove('d-none'); } }
function hideError(id) { const el = document.getElementById(id); if (el) el.classList.add('d-none'); }
function _getSelectedVehicle() { return document.getElementById('vehicle-filter-select')?.value ?? ''; }

function _calculateAllTimeAvg(vehicleName) {
  const allLogs = store.get('tripLogs') ?? [];
  const sorted = allLogs.filter(l => l.vehicleName === vehicleName).sort((a, b) => a.odoReading - b.odoReading);
  if (sorted.length < 2) return null;
  
  let totalDistance = 0;
  let totalLitres = 0;
  
  for (let i = 1; i < sorted.length; i++) {
    const log = sorted[i];
    const prev = sorted[i - 1];
    const distance = log.odoReading - prev.odoReading;
    if (log.fuelLitres > 0 && distance > 0) {
      totalDistance += distance;
      totalLitres += log.fuelLitres;
    }
  }
  
  return totalLitres > 0 ? (totalDistance / totalLitres).toFixed(2) : null;
}

let _editingTripId = null;
let _editingVehicleExpId = null;
let _editingMaintenanceId = null;
let _editingVehicleId = null;
let _selectedStatsMonth = null; // null = current month

// ─── Paginators ───────────────────────────────────────────────────────────────
let _tripPaginator      = null;
let _vePaginator        = null;
let _maintPaginator     = null;
let _insurancePaginator = null;

function _getTripPaginator() {
  if (!_tripPaginator) {
    _tripPaginator = createPaginator({
      containerId: 'trip-log-cards',
      paginationId: 'trip-log-pagination',
      pageSize: 12,
      renderPage(slice) {
        const container = document.getElementById('trip-log-cards');
        const emptyState = document.getElementById('trip-log-empty-state');
        if (!container) return;
        if (slice.length === 0) {
          container.innerHTML = '';
          if (emptyState) emptyState.classList.remove('d-none');
          return;
        }
        if (emptyState) emptyState.classList.add('d-none');
        const VICONS = { Bike: 'bi-bicycle', Car: 'bi-car-front-fill', Scooter: 'bi-scooter', Truck: 'bi-truck' };
        const vehicles = store.get('vehicles') ?? [];
        const allSorted = {};
        vehicles.forEach(v => { allSorted[v.name] = _getVehicleLogs(v.name); });
        container.innerHTML = `<div class="data-cards-grid">${slice.map(l => {
          const sorted    = allSorted[l.vehicleName] ?? [];
          const dist      = _computeDistance(l, sorted);
          const mileage   = l.fuelLitres > 0 && dist > 0 ? (dist / l.fuelLitres).toFixed(2) : null;
          const costPerKm = dist > 0 && l.fuelCost > 0 ? (l.fuelCost / dist).toFixed(2) : null;
          const vType     = vehicles.find(v => v.name === l.vehicleName)?.type ?? 'Car';
          const ico       = VICONS[vType] ?? 'bi-car-front-fill';
          return `
          <div class="data-card trip-card">
            <div class="dc-header">
              <div class="dc-icon trip-icon-${(vType||'car').toLowerCase()}"><i class="bi ${ico}"></i></div>
              <div class="dc-meta">
                <div class="dc-title">${escapeHtml(l.purpose)}</div>
                <div class="dc-subtitle">${escapeHtml(l.vehicleName)}</div>
              </div>
              <div class="dc-amount trip-odo-amt">${l.odoReading.toLocaleString('en-IN')} km</div>
            </div>
            <div class="tcs-row">
              <div class="tcs-stat"><span class="tcs-label">Distance</span><span class="tcs-value">${dist > 0 ? dist.toLocaleString('en-IN') + ' km' : '—'}</span></div>
              <div class="tcs-stat"><span class="tcs-label">Mileage</span><span class="tcs-value tcs-value--highlight">${mileage ? mileage + ' km/L' : '—'}</span></div>
              <div class="tcs-stat"><span class="tcs-label">Fuel</span><span class="tcs-value">${l.fuelLitres > 0 ? (+l.fuelLitres.toFixed(2)) + ' L' : '—'}</span></div>
              <div class="tcs-stat"><span class="tcs-label">₹ / Litre</span><span class="tcs-value">${l.pricePerLitre > 0 ? '₹' + l.pricePerLitre.toFixed(2) : '—'}</span></div>
              <div class="tcs-stat"><span class="tcs-label">Fuel Cost</span><span class="tcs-value">${l.fuelCost > 0 ? formatCurrency(l.fuelCost) : '—'}</span></div>
              <div class="tcs-stat"><span class="tcs-label">Cost / km</span><span class="tcs-value">${costPerKm ? '₹' + costPerKm : '—'}</span></div>
            </div>
            <div class="dc-footer">
              <span class="dc-badge"><i class="bi bi-calendar3 me-1"></i>${formatDate(l.date)}</span>
              <div class="dc-actions">
                <button class="btn btn-sm btn-outline-primary" data-edit-trip="${escapeHtml(l.id)}" title="Edit"><i class="bi bi-pencil-fill"></i></button>
                <button class="btn btn-sm btn-outline-danger" data-delete-trip="${escapeHtml(l.id)}" title="Delete"><i class="bi bi-trash-fill"></i></button>
              </div>
            </div>
          </div>`;
        }).join('')}</div>`;
        container.querySelectorAll('[data-edit-trip]').forEach(btn => btn.addEventListener('click', () => _startEditTrip(btn.dataset.editTrip)));
        container.querySelectorAll('[data-delete-trip]').forEach(btn => btn.addEventListener('click', () => _deleteTrip(btn.dataset.deleteTrip)));
      },
    });
  }
  return _tripPaginator;
}

function _getVePaginator() {
  if (!_vePaginator) {
    _vePaginator = createPaginator({
      containerId: 'vehicle-expense-cards',
      paginationId: 'vehicle-expense-pagination',
      pageSize: 12,
      renderPage(slice) {
        const container = document.getElementById('vehicle-expense-cards');
        const emptyState = document.getElementById('vehicle-expense-empty-state');
        if (!container) return;
        if (slice.length === 0) {
          container.innerHTML = '';
          if (emptyState) emptyState.classList.remove('d-none');
          return;
        }
        if (emptyState) emptyState.classList.add('d-none');
        container.innerHTML = `<div class="data-cards-grid">${slice.map(e => `
          <div class="data-card ve-card">
            <div class="dc-header">
              <div class="dc-icon ve-icon"><i class="bi bi-tools"></i></div>
              <div class="dc-meta">
                <div class="dc-title">${escapeHtml(e.expenseType)}</div>
                <div class="dc-subtitle">${escapeHtml(e.vehicleName)}${e.description ? ` · ${escapeHtml(e.description)}` : ''}</div>
              </div>
              <div class="dc-amount expense-amount">${formatCurrency(e.amount)}</div>
            </div>
            <div class="dc-footer">
              <span class="dc-badge"><i class="bi bi-calendar3 me-1"></i>${formatDate(e.date)}</span>
              <span class="dc-badge"><i class="bi bi-credit-card me-1"></i>${escapeHtml(e.paymentMethod)}</span>
              <div class="dc-actions">
                <button class="btn btn-sm btn-outline-primary" data-edit-ve="${escapeHtml(e.id)}" title="Edit"><i class="bi bi-pencil-fill"></i></button>
                <button class="btn btn-sm btn-outline-danger" data-delete-ve="${escapeHtml(e.id)}" title="Delete"><i class="bi bi-trash-fill"></i></button>
              </div>
            </div>
          </div>
        `).join('')}</div>`;
        container.querySelectorAll('[data-edit-ve]').forEach(btn => btn.addEventListener('click', () => _startEditVehicleExp(btn.dataset.editVe)));
        container.querySelectorAll('[data-delete-ve]').forEach(btn => btn.addEventListener('click', () => _deleteVehicleExp(btn.dataset.deleteVe)));
      },
    });
  }
  return _vePaginator;
}

function _getMaintPaginator() {
  if (!_maintPaginator) {
    _maintPaginator = createPaginator({
      containerId: 'maintenance-cards',
      paginationId: 'maintenance-pagination',
      pageSize: 4,
      renderPage(slice) {
        const container  = document.getElementById('maintenance-cards');
        const emptyState = document.getElementById('maintenance-empty-state');
        if (!container) return;
        if (slice.length === 0) {
          container.innerHTML = '';
          if (emptyState) emptyState.classList.remove('d-none');
          return;
        }
        if (emptyState) emptyState.classList.add('d-none');
        _renderMaintenanceSlice(container, slice);
      },
    });
  }
  return _maintPaginator;
}

function _getInsurancePaginator() {
  if (!_insurancePaginator) {
    _insurancePaginator = createPaginator({
      containerId: 'insurance-policies-list',
      paginationId: 'insurance-pagination',
      pageSize: 8,
      renderPage(slice) {
        // rendering handled directly in renderInsurancePolicies
      },
    });
  }
  return _insurancePaginator;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _getVehicleLogs(vehicleName) {
  return (store.get('tripLogs') ?? [])
    .filter(l => l.vehicleName === vehicleName)
    .sort((a, b) => a.odoReading - b.odoReading);
}

function _computeDistance(log, sortedLogs) {
  const idx = sortedLogs.findIndex(l => l.id === log.id);
  if (idx <= 0) return 0;
  return log.odoReading - sortedLogs[idx - 1].odoReading;
}

function _getLastOdo(vehicleName) {
  const logs = _getVehicleLogs(vehicleName);
  return logs.length > 0 ? logs[logs.length - 1].odoReading : null;
}

function _getLastOdoExcluding(vehicleName, excludeId) {
  const logs = _getVehicleLogs(vehicleName).filter(l => l.id !== excludeId);
  return logs.length > 0 ? logs[logs.length - 1].odoReading : null;
}

function _getPaymentMethodOptions() {
  const accounts = store.get('accounts') ?? [];
  const creditCards = store.get('creditCards') ?? [];
  return [...accounts.map(a => a.name), ...creditCards.map(c => c.name)];
}

function _populateVehicleDropdowns() {
  const vehicles = store.get('vehicles') ?? [];
  const opts = vehicles.map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)}</option>`).join('');
  ['trip-vehicle', 've-vehicle'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">Select vehicle…</option>' + opts;
    if (cur) sel.value = cur;
  });
  const filterSel = document.getElementById('vehicle-filter-select');
  if (filterSel) {
    const cur = filterSel.value;
    filterSel.innerHTML = '<option value="">All Vehicles</option>' + opts;
    if (cur) filterSel.value = cur;
  }
}

function _refreshVePaymentMethods() {
  const typeSel = document.getElementById('ve-payment-type');
  const valueSel = document.getElementById('ve-payment-method');
  if (!typeSel || !valueSel) return;
  const type = typeSel.value;
  const accounts    = store.get('accounts')    ?? [];
  const creditCards = store.get('creditCards') ?? [];
  const cur = valueSel.value;
  let items = [];
  if (type === 'account') items = accounts.filter(a => !['Wallet','Cash'].includes(a.type)).map(a => a.name);
  else if (type === 'wallet') items = accounts.filter(a => a.type === 'Wallet').map(a => a.name);
  else if (type === 'cash')   items = accounts.filter(a => a.type === 'Cash').map(a => a.name);
  else if (type === 'card')   items = creditCards.map(c => c.name);
  valueSel.innerHTML = `<option value="">Select…</option>` +
    items.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
  valueSel.disabled = !type;
  if (cur && items.includes(cur)) valueSel.value = cur;
}

function _refreshVeExpenseTypes() {
  const sel = document.getElementById('ve-type');
  if (!sel) return;
  const cur = sel.value;
  const types = (store.get('vehicleExpenseTypes') ?? []).map(t => t.name);
  sel.innerHTML = '<option value="">Select type…</option>' +
    types.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  if (cur) sel.value = cur;
}

// ─── Render ───────────────────────────────────────────────────────────────────

export function render() {
  _populateVehicleDropdowns();
  _refreshVePaymentMethods();
  _refreshVeExpenseTypes();
  renderVehicleList();
  renderTripLogs();
  renderVehicleExpenses();
  renderMonthlySummary();
  renderMaintenance();
  renderVehicleDocuments();

  // Stat cards
  const vehicles = store.get('vehicles') ?? [];
  const trips = store.get('tripLogs') ?? [];
  const veExps = store.get('vehicleExpenses') ?? [];
  const totalVeExpenses = veExps.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const el = id => document.getElementById(id);
  if (el('veh-stat-count')) el('veh-stat-count').textContent = vehicles.length;
  if (el('veh-stat-trips')) el('veh-stat-trips').textContent = trips.length;
  if (el('veh-stat-expenses')) el('veh-stat-expenses').textContent = formatCurrency(totalVeExpenses);
}

export function renderVehicleList() {
  const vehicles = store.get('vehicles') ?? [];
  _populateVehicleDropdowns();

  const container = document.getElementById('vehicles-list-body');
  const emptyState = document.getElementById('vehicles-list-empty-state');
  if (!container) return;

  if (vehicles.length === 0) {
    container.innerHTML = '';
    if (emptyState) emptyState.classList.remove('d-none');
    return;
  }
  if (emptyState) emptyState.classList.add('d-none');

  container.innerHTML = vehicles.map(v => {
    const allTimeAvg = _calculateAllTimeAvg(v.name);
    const avgBadge = allTimeAvg ? `<span class="badge bg-success-subtle text-success-emphasis ms-2" style="font-size:.7rem"><i class="bi bi-speedometer2 me-1"></i>${allTimeAvg} km/L</span>` : '';
    return `
    <div class="vehicle-chip">
      <span class="vehicle-chip-icon"><i class="bi bi-car-front-fill"></i></span>
      <div class="vehicle-chip-info">
        <span class="vehicle-chip-name">${escapeHtml(v.name)}${avgBadge}</span>
        <span class="vehicle-chip-meta">${escapeHtml(v.type)}${v.regNumber ? ' · ' + escapeHtml(v.regNumber) : ''}</span>
      </div>
      <button class="vehicle-chip-edit" data-edit-vehicle="${escapeHtml(v.id)}" title="Edit"><i class="bi bi-pencil-fill"></i></button>
      <button class="vehicle-chip-del" data-delete-vehicle="${escapeHtml(v.id)}" title="Delete"><i class="bi bi-x"></i></button>
    </div>
  `;
  }).join('');

  container.querySelectorAll('[data-edit-vehicle]').forEach(btn => {
    btn.addEventListener('click', () => _startEditVehicle(btn.dataset.editVehicle));
  });
  container.querySelectorAll('[data-delete-vehicle]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await epConfirm('Delete this vehicle?', 'Delete Vehicle', 'Delete')) return;
      await _deleteVehicle(btn.dataset.deleteVehicle);
    });
  });
}

export function renderTripLogs() {
  const filterVehicle = _getSelectedVehicle();
  let logs = store.get('tripLogs') ?? [];
  if (filterVehicle) logs = logs.filter(l => l.vehicleName === filterVehicle);
  logs = [...logs].sort((a, b) => b.date.localeCompare(a.date));
  _getTripPaginator().update(logs);
}

export function renderVehicleExpenses() {
  const filterVehicle = _getSelectedVehicle();
  let exps = store.get('vehicleExpenses') ?? [];
  if (filterVehicle) exps = exps.filter(e => e.vehicleName === filterVehicle);
  exps = [...exps].sort((a, b) => b.date.localeCompare(a.date));
  _getVePaginator().update(exps);
}

export function renderMonthlySummary() {
  const container = document.getElementById('vehicle-monthly-summary');
  if (!container) return;

  const now = new Date();
  const targetDate = _selectedStatsMonth ? new Date(_selectedStatsMonth + '-01') : now;
  const year  = targetDate.getFullYear();
  const month = targetDate.getMonth();
  const monthLabel = targetDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  const vehicles = store.get('vehicles') ?? [];
  const allLogs  = store.get('tripLogs') ?? [];

  // Generate month options (last 24 months)
  const monthOptions = [];
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const selected = _selectedStatsMonth === value || (!_selectedStatsMonth && i === 0);
    monthOptions.push(`<option value="${value}" ${selected ? 'selected' : ''}>${label}</option>`);
  }

  function _statsForVehicle(vName) {
    const sorted = allLogs.filter(l => l.vehicleName === vName).sort((a, b) => a.odoReading - b.odoReading);

    // Monthly
    const beforeMonth = sorted.filter(l => { const d = new Date(l.date); return d < new Date(year, month, 1); });
    const startOdo    = beforeMonth.length > 0 ? beforeMonth[beforeMonth.length - 1].odoReading : null;
    const thisMonth   = sorted.filter(l => { const d = new Date(l.date); return d.getFullYear() === year && d.getMonth() === month; });

    let mDist = 0;
    if (thisMonth.length > 0 && startOdo !== null) {
      mDist = Math.max(...thisMonth.map(l => l.odoReading)) - startOdo;
    } else if (thisMonth.length > 1) {
      mDist = Math.max(...thisMonth.map(l => l.odoReading)) - Math.min(...thisMonth.map(l => l.odoReading));
    }

    let mLitres = 0, mFuelCost = 0;
    thisMonth.forEach(l => {
      if (sorted.findIndex(s => s.id === l.id) > 0) {
        mLitres   += l.fuelLitres ?? 0;
        mFuelCost += l.fuelCost   ?? 0;
      }
    });

    const mMileage    = mLitres > 0 && mDist > 0 ? (mDist / mLitres).toFixed(2) : null;
    const mCostPerKm  = mDist > 0 && mFuelCost > 0 ? (mFuelCost / mDist).toFixed(2) : null;
    const mPricePerL  = mLitres > 0 && mFuelCost > 0 ? (mFuelCost / mLitres).toFixed(2) : null;

    // All-time
    let atDist = 0, atLitres = 0, atCost = 0;
    for (let i = 1; i < sorted.length; i++) {
      const log = sorted[i], prev = sorted[i - 1];
      const d = log.odoReading - prev.odoReading;
      if (d > 0) {
        atDist  += d;
        atLitres += log.fuelLitres ?? 0;
        atCost   += log.fuelCost   ?? 0;
      }
    }
    const atMileage   = atLitres > 0 ? (atDist / atLitres).toFixed(2) : null;
    const atCostPerKm = atDist   > 0 ? (atCost / atDist).toFixed(2)   : null;
    const lastOdo     = sorted.length > 0 ? sorted[sorted.length - 1].odoReading : null;

    return { mDist, mLitres, mFuelCost, mMileage, mCostPerKm, mPricePerL, atDist, atLitres, atCost, atMileage, atCostPerKm, lastOdo, hasData: sorted.length > 0 };
  }

  function _statBox(label, value, unit, icon, colorClass) {
    return `
    <div class="vperf-stat-box">
      <div class="vperf-stat-icon ${colorClass}"><i class="bi ${icon}"></i></div>
      <div class="vperf-stat-body">
        <div class="vperf-stat-label">${label}</div>
        <div class="vperf-stat-value">${value !== null ? `${value}${unit ? '<span class="vperf-stat-unit"> '+unit+'</span>' : ''}` : '<span class="text-muted">—</span>'}</div>
      </div>
    </div>`;
  }

  const vehicleCards = vehicles.map((v, idx) => {
    const s      = _statsForVehicle(v.name);
    const ico    = VEHICLE_ICONS[v.type] ?? VEHICLE_ICONS.default;
    const cardId = `vperf-body-${idx}`;
    const openClass = ''; // No vehicle is open by default

    if (!s.hasData) return `
    <div class="vperf-card mb-2">
      <div class="vperf-accordion-header" data-vperf-toggle="${cardId}">
        <div class="vperf-vehicle-icon"><i class="bi ${ico}"></i></div>
        <div class="vperf-vehicle-info">
          <div class="vperf-vehicle-name">${escapeHtml(v.name)}</div>
          <div class="vperf-vehicle-meta">${escapeHtml(v.type)}${v.regNumber ? ' · ' + escapeHtml(v.regNumber) : ''}</div>
        </div>
        <span class="vperf-no-data-chip"><i class="bi bi-info-circle me-1"></i>No data</span>
        <i class="bi bi-chevron-down vperf-chevron"></i>
      </div>
    </div>`;

    return `
    <div class="vperf-card mb-2">
      <div class="vperf-accordion-header" data-vperf-toggle="${cardId}">
        <div class="vperf-vehicle-icon"><i class="bi ${ico}"></i></div>
        <div class="vperf-vehicle-info">
          <div class="vperf-vehicle-name">${escapeHtml(v.name)}</div>
          <div class="vperf-vehicle-meta">${escapeHtml(v.type)}${v.regNumber ? ' · ' + escapeHtml(v.regNumber) : ''}${s.lastOdo ? ' · ' + s.lastOdo.toLocaleString('en-IN') + ' km' : ''}</div>
        </div>
        <div class="vperf-header-chips">
          ${s.mMileage    ? `<span class="vperf-chip vperf-chip-green"><i class="bi bi-speedometer2 me-1"></i>${s.mMileage} km/L</span>` : ''}
          ${s.mCostPerKm  ? `<span class="vperf-chip vperf-chip-purple"><i class="bi bi-signpost-2-fill me-1"></i>₹${s.mCostPerKm}/km</span>` : ''}
          ${s.mDist > 0   ? `<span class="vperf-chip vperf-chip-blue"><i class="bi bi-geo-alt-fill me-1"></i>${s.mDist.toLocaleString('en-IN')} km</span>` : ''}
        </div>
        <i class="bi bi-chevron-down vperf-chevron ${openClass ? 'vperf-chevron-open' : ''}"></i>
      </div>
      <div class="vperf-body ${openClass}" id="${cardId}">
        <div class="vperf-stats-grid">
          ${_statBox('Distance',   s.mDist > 0 ? s.mDist.toLocaleString('en-IN') : null, 'km',  'bi-geo-alt-fill',       'vperf-icon-blue')}
          ${_statBox('Fuel Used',  s.mLitres > 0 ? s.mLitres.toFixed(2) : null,          'L',   'bi-fuel-pump-fill',     'vperf-icon-amber')}
          ${_statBox('Avg Mileage',s.mMileage,                                           'km/L','bi-speedometer2',       'vperf-icon-green')}
          ${_statBox('Cost / km',  s.mCostPerKm ? '₹'+s.mCostPerKm : null,               '',    'bi-signpost-2-fill',    'vperf-icon-purple')}
          ${_statBox('Fuel Spend', s.mFuelCost > 0 ? formatCurrency(s.mFuelCost) : null, '',    'bi-currency-rupee',     'vperf-icon-red')}
          ${_statBox('₹ / Litre',  s.mPricePerL ? '₹'+s.mPricePerL : null,              '',    'bi-droplet-fill',       'vperf-icon-teal')}
        </div>
        <div class="vperf-alltime-row">
          <span class="vperf-alltime-label"><i class="bi bi-infinity me-1"></i>All-Time</span>
          <div class="vperf-alltime-chips">
            <span class="vperf-chip vperf-chip-green"><i class="bi bi-speedometer2 me-1"></i>${s.atMileage ? s.atMileage+' km/L' : '—'}</span>
            <span class="vperf-chip vperf-chip-purple"><i class="bi bi-signpost-2-fill me-1"></i>${s.atCostPerKm ? '₹'+s.atCostPerKm+'/km' : '—'}</span>
            <span class="vperf-chip vperf-chip-blue"><i class="bi bi-geo-alt-fill me-1"></i>${s.atDist > 0 ? s.atDist.toLocaleString('en-IN')+' km' : '—'}</span>
            <span class="vperf-chip vperf-chip-amber"><i class="bi bi-fuel-pump-fill me-1"></i>${s.atLitres > 0 ? s.atLitres.toFixed(1)+' L' : '—'}</span>
            <span class="vperf-chip vperf-chip-red"><i class="bi bi-currency-rupee me-1"></i>${s.atCost > 0 ? formatCurrency(s.atCost) : '—'}</span>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  container.innerHTML = `
    <div class="vperf-header mb-3">
      <h6 class="vperf-title mb-0"><i class="bi bi-speedometer2 me-2 text-primary"></i>Vehicle Performance</h6>
      <select class="form-select form-select-sm w-auto" id="vehicle-stats-month-select">
        ${monthOptions.join('')}
      </select>
    </div>
    ${vehicles.length === 0
      ? `<div class="text-muted small text-center py-3"><i class="bi bi-car-front me-2"></i>No vehicles added yet.</div>`
      : vehicleCards
    }`;

  const monthSelect = document.getElementById('vehicle-stats-month-select');
  if (monthSelect) {
    monthSelect.addEventListener('change', e => {
      _selectedStatsMonth = e.target.value;
      renderMonthlySummary();
    });
  }

  // Accordion toggles
  container.querySelectorAll('[data-vperf-toggle]').forEach(header => {
    header.addEventListener('click', () => {
      const bodyId = header.dataset.vperfToggle;
      const body   = document.getElementById(bodyId);
      const chevron = header.querySelector('.vperf-chevron');
      if (!body) return;
      const isOpen = body.classList.contains('vperf-body-open');
      body.classList.toggle('vperf-body-open', !isOpen);
      chevron?.classList.toggle('vperf-chevron-open', !isOpen);
    });
  });
}


// ─── Edit / Delete ────────────────────────────────────────────────────────────

function _startEditTrip(id) {
  const log = (store.get('tripLogs') ?? []).find(l => l.id === id);
  if (!log) return;
  _editingTripId = id;
  document.getElementById('trip-date').value = log.date;
  document.getElementById('trip-vehicle').value = log.vehicleName;
  document.getElementById('trip-odo').value = log.odoReading;
  document.getElementById('trip-fuel-cost').value = log.fuelCost || '';
  document.getElementById('trip-fuel-litres').value = log.fuelLitres || '';
  document.getElementById('trip-purpose').value = log.purpose;
  const pplInput = document.getElementById('trip-price-per-litre');
  if (pplInput) pplInput.value = log.pricePerLitre || '';
  const cancelBtn = document.getElementById('trip-log-cancel-edit');
  if (cancelBtn) cancelBtn.classList.remove('d-none');
  // Open the modal
  const modal = document.getElementById('oc-trip');
  if (modal) bootstrap.Modal.getOrCreateInstance(modal).show();
}

async function _deleteTrip(id) {
  const allLogs = store.get('tripLogs') ?? [];
  const deleted = allLogs.find(l => l.id === id);
  const logs = allLogs.filter(l => l.id !== id);
  await writeAllRows(CONFIG.sheets.tripLogs, logs.map(serializeTripLog));
  store.set('tripLogs', logs);
  const { showUndoToast } = await import('./undo.js');
  showUndoToast('Trip log deleted', async () => {
    const current = [...(store.get('tripLogs') ?? []), deleted];
    await writeAllRows(CONFIG.sheets.tripLogs, current.map(serializeTripLog));
    store.set('tripLogs', current);
  });
}

function _startEditVehicleExp(id) {
  const exp = (store.get('vehicleExpenses') ?? []).find(e => e.id === id);
  if (!exp) return;
  _editingVehicleExpId = id;
  document.getElementById('ve-date').value = exp.date;
  document.getElementById('ve-vehicle').value = exp.vehicleName;
  document.getElementById('ve-type').value = exp.expenseType;
  document.getElementById('ve-amount').value = exp.amount;
  restorePaymentSelects('ve-payment-type', 've-payment-method', exp.paymentMethod, store);
  document.getElementById('ve-description').value = exp.description;
  const cancelBtn = document.getElementById('vehicle-expense-cancel-edit');
  if (cancelBtn) cancelBtn.classList.remove('d-none');
  // Open the modal
  const modal = document.getElementById('oc-vehicle-expense');
  if (modal) bootstrap.Modal.getOrCreateInstance(modal).show();
}

async function _deleteVehicleExp(id) {
  if (!await epConfirm('Delete this vehicle expense?')) return;
  const allVeExps = store.get('vehicleExpenses') ?? [];
  const deleted = allVeExps.find(e => e.id === id);
  const exps = allVeExps.filter(e => e.id !== id);
  await writeAllRows(CONFIG.sheets.vehicleExp, exps.map(serializeVehicleExpense));
  store.set('vehicleExpenses', exps);

  // Also remove the mirrored expense
  const { deserialize: deExp, serialize: serExp } = await import('./expenses.js');
  const allExps = store.get('expenses') ?? [];
  const deletedMirrored = allExps.find(e => e.description && e.description.includes(`[ve:${id}]`));
  const newExps = allExps.filter(e => !(e.description && e.description.includes(`[ve:${id}]`)));
  if (newExps.length !== allExps.length) {
    await writeAllRows(CONFIG.sheets.expenses, newExps.map(serExp));
    store.set('expenses', newExps);
  }
  
  const { showUndoToast } = await import('./undo.js');
  showUndoToast('Vehicle expense deleted', async () => {
    const currentVe = [...(store.get('vehicleExpenses') ?? []), deleted];
    await writeAllRows(CONFIG.sheets.vehicleExp, currentVe.map(serializeVehicleExpense));
    store.set('vehicleExpenses', currentVe);
    if (deletedMirrored) {
      const currentExp = [...(store.get('expenses') ?? []), deletedMirrored];
      await writeAllRows(CONFIG.sheets.expenses, currentExp.map(serExp));
      store.set('expenses', currentExp);
    }
  });
}

async function _deleteVehicle(id) {
  const allVehicles = store.get('vehicles') ?? [];
  const deleted = allVehicles.find(v => v.id === id);
  const vehicles = allVehicles.filter(v => v.id !== id);
  await writeAllRows(CONFIG.sheets.vehicles, vehicles.map(serializeVehicle));
  store.set('vehicles', vehicles);
  const { showUndoToast } = await import('./undo.js');
  showUndoToast('Vehicle deleted', async () => {
    const current = [...(store.get('vehicles') ?? []), deleted];
    await writeAllRows(CONFIG.sheets.vehicles, current.map(serializeVehicle));
    store.set('vehicles', current);
  });
}

// ─── Form binding ─────────────────────────────────────────────────────────────

function _startEditVehicle(id) {
  const vehicle = (store.get('vehicles') ?? []).find(v => v.id === id);
  if (!vehicle) return;
  _editingVehicleId = id;
  const f = i => document.getElementById(i);
  if (f('vehicle-name')) f('vehicle-name').value = vehicle.name;
  if (f('vehicle-type')) f('vehicle-type').value = vehicle.type;
  if (f('vehicle-reg'))  f('vehicle-reg').value  = vehicle.regNumber ?? '';
  const label = document.getElementById('oc-vehicle-label');
  if (label) label.textContent = 'Edit Vehicle';
  const submitBtn = document.querySelector('#vehicle-form button[type="submit"]');
  if (submitBtn) submitBtn.textContent = 'Save Changes';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('oc-vehicle')).show();
}

function _bindVehicleForm() {
  const form = document.getElementById('vehicle-form');
  if (!form) return;

  const modal = document.getElementById('oc-vehicle');
  if (modal) {
    modal.addEventListener('hidden.bs.modal', () => {
      _editingVehicleId = null;
      form.reset();
      const label = document.getElementById('oc-vehicle-label');
      if (label) label.textContent = 'Add Vehicle';
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.textContent = 'Add Vehicle';
      hideError('vehicle-error-banner');
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('vehicle-name')?.value?.trim() ?? '';
    const type = document.getElementById('vehicle-type')?.value?.trim() ?? '';
    const regNumber = document.getElementById('vehicle-reg')?.value?.trim() ?? '';
    if (!name || !type) { showError('vehicle-error-banner', 'Name and type are required.'); return; }
    hideError('vehicle-error-banner');
    try {
      let vehicles = store.get('vehicles') ?? [];
      if (_editingVehicleId) {
        vehicles = vehicles.map(v => v.id === _editingVehicleId ? { id: _editingVehicleId, name, type, regNumber } : v);
        await writeAllRows(CONFIG.sheets.vehicles, vehicles.map(serializeVehicle));
        store.set('vehicles', vehicles);
      } else {
        const id = crypto.randomUUID();
        const vehicle = { id, name, type, regNumber };
        await appendRow(CONFIG.sheets.vehicles, serializeVehicle(vehicle));
        const rows = await fetchRows(CONFIG.sheets.vehicles);
        store.set('vehicles', rows.map(deserializeVehicle).filter(v => v.id));
      }
      form.reset();
      if (modal) bootstrap.Modal.getInstance(modal)?.hide();
    } catch (err) { showError('vehicle-error-banner', err.message ?? 'Failed to save vehicle.'); }
  });
}

function _bindTripLogForm() {
  const form = document.getElementById('trip-log-form');
  if (!form) return;
  const cancelBtn = document.getElementById('trip-log-cancel-edit');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      _editingTripId = null;
      form.reset();
      cancelBtn.classList.add('d-none');
    });
  }

  // Auto-calculate pricePerLitre and fuelCost
  const fuelCostInput   = document.getElementById('trip-fuel-cost');
  const fuelLitresInput = document.getElementById('trip-fuel-litres');
  const pplInput        = document.getElementById('trip-price-per-litre');

  function _autoCalcPpl() {
    if (!fuelCostInput || !fuelLitresInput || !pplInput) return;
    if (document.activeElement === pplInput) return; // user is manually typing price
    const cost   = parseFloat(fuelCostInput.value);
    const litres = parseFloat(fuelLitresInput.value);
    if (cost > 0 && litres > 0) {
      pplInput.value = (cost / litres).toFixed(2);
    }
  }

  function _autoCalcCost() {
    if (!fuelCostInput || !fuelLitresInput || !pplInput) return;
    if (document.activeElement === fuelCostInput) return; // user is manually typing cost
    const ppl    = parseFloat(pplInput.value);
    const litres = parseFloat(fuelLitresInput.value);
    if (ppl > 0 && litres > 0) {
      fuelCostInput.value = (ppl * litres).toFixed(2);
    }
  }

  if (fuelCostInput)   fuelCostInput.addEventListener('input', _autoCalcPpl);
  if (fuelLitresInput) fuelLitresInput.addEventListener('input', () => {
    // When litres changes: if price/L is set, recalc cost; else if cost is set, recalc price/L
    const hasPpl  = parseFloat(pplInput?.value) > 0;
    const hasCost = parseFloat(fuelCostInput?.value) > 0;
    if (hasPpl) _autoCalcCost();
    else if (hasCost) _autoCalcPpl();
  });
  if (pplInput) pplInput.addEventListener('input', _autoCalcCost);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const vehicleName    = document.getElementById('trip-vehicle')?.value ?? '';
    const date           = document.getElementById('trip-date')?.value ?? '';
    const odoReading     = parseFloat(document.getElementById('trip-odo')?.value) || 0;
    const fuelCost       = parseFloat(document.getElementById('trip-fuel-cost')?.value) || 0;
    const fuelLitres     = parseFloat(document.getElementById('trip-fuel-litres')?.value) || 0;
    const purpose        = document.getElementById('trip-purpose')?.value?.trim() ?? '';
    const pricePerLitre  = parseFloat(document.getElementById('trip-price-per-litre')?.value) || 0;
    if (!vehicleName || !date || !odoReading || !purpose) {
      showError('trip-log-error-banner', 'Please fill in all required fields.');
      return;
    }
    hideError('trip-log-error-banner');
    if (odoReading <= 0) { showError('trip-log-error-banner', 'ODO reading must be positive.'); return; }
    const lastOdo = _editingTripId
      ? _getLastOdoExcluding(vehicleName, _editingTripId)
      : _getLastOdo(vehicleName);
    if (lastOdo !== null && odoReading <= lastOdo) {
      showError('trip-log-error-banner', `ODO must be greater than last reading (${lastOdo.toLocaleString('en-IN')} km).`);
      return;
    }
    const id = _editingTripId ?? crypto.randomUUID();
    const record = { id, vehicleName, date, odoReading, fuelCost, fuelLitres, purpose, pricePerLitre };
    try {
      let logs = store.get('tripLogs') ?? [];
      logs = _editingTripId ? logs.map(l => l.id === _editingTripId ? record : l) : [...logs, record];
      await writeAllRows(CONFIG.sheets.tripLogs, logs.map(serializeTripLog));
      store.set('tripLogs', logs);
      _editingTripId = null;
      form.reset();
      if (cancelBtn) cancelBtn.classList.add('d-none');
      const tripModal = document.getElementById('oc-trip');
      if (tripModal) bootstrap.Modal.getInstance(tripModal)?.hide();
    } catch (err) { showError('trip-log-error-banner', err.message ?? 'Failed to save trip log.'); }
  });
}

function _bindVehicleExpenseForm() {
  const form = document.getElementById('vehicle-expense-form');
  if (!form) return;
  const cancelBtn = document.getElementById('vehicle-expense-cancel-edit');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      _editingVehicleExpId = null;
      form.reset();
      cancelBtn.classList.add('d-none');
    });
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const vehicleName   = document.getElementById('ve-vehicle')?.value ?? '';
    const date          = document.getElementById('ve-date')?.value ?? '';
    const expenseType   = document.getElementById('ve-type')?.value ?? '';
    const amount        = parseFloat(document.getElementById('ve-amount')?.value) || 0;
    const paymentMethod = document.getElementById('ve-payment-method')?.value ?? '';
    const description   = document.getElementById('ve-description')?.value?.trim() ?? '';
    if (!vehicleName || !date || !expenseType || !amount || !paymentMethod) {
      showError('vehicle-expense-error-banner', 'Please fill in all required fields.');
      return;
    }
    if (amount <= 0) { showError('vehicle-expense-error-banner', 'Amount must be positive.'); return; }
    hideError('vehicle-expense-error-banner');
    const id = _editingVehicleExpId ?? crypto.randomUUID();
    const record = { id, vehicleName, date, expenseType, amount, paymentMethod, description };
    try {
      let exps = store.get('vehicleExpenses') ?? [];
      exps = _editingVehicleExpId ? exps.map(ex => ex.id === _editingVehicleExpId ? record : ex) : [...exps, record];
      await writeAllRows(CONFIG.sheets.vehicleExp, exps.map(serializeVehicleExpense));
      store.set('vehicleExpenses', exps);
      if (!_editingVehicleExpId) {
        // New vehicle expense — mirror to expenses sheet with a link marker
        const mirrored = { date, category: expenseType, subCategory: '', amount, description: `${description || `Vehicle: ${vehicleName}`} [ve:${id}]`, paymentMethod };
        await appendRow(CONFIG.sheets.expenses, serializeExpense(mirrored));
        const { fetchRows: fr } = await import('./api.js');
        const { deserialize: deExp } = await import('./expenses.js');
        store.set('expenses', (await fr(CONFIG.sheets.expenses)).map(deExp));
      } else {
        // Edit — update the mirrored expense if it exists
        const { deserialize: deExp, serialize: serExp } = await import('./expenses.js');
        const allExps = store.get('expenses') ?? [];
        const mirrorIdx = allExps.findIndex(e => e.description && e.description.includes(`[ve:${id}]`));
        if (mirrorIdx !== -1) {
          const updated = { ...allExps[mirrorIdx], date, category: expenseType, amount, paymentMethod, description: `${description || `Vehicle: ${vehicleName}`} [ve:${id}]` };
          const newExps = allExps.map((e, i) => i === mirrorIdx ? updated : e);
          await writeAllRows(CONFIG.sheets.expenses, newExps.map(serExp));
          store.set('expenses', newExps);
        }
      }
      _editingVehicleExpId = null;
      form.reset();
      if (cancelBtn) cancelBtn.classList.add('d-none');
      const veModal = document.getElementById('oc-vehicle-expense');
      if (veModal) bootstrap.Modal.getInstance(veModal)?.hide();
    } catch (err) { showError('vehicle-expense-error-banner', err.message ?? 'Failed to save vehicle expense.'); }
  });
}

// ─── Maintenance ──────────────────────────────────────────────────────────────

export function renderMaintenance() {
  const emptyState = document.getElementById('maintenance-empty-state');

  const records = store.get('maintenance') ?? [];
  const filterVehicle = _getSelectedVehicle();
  const filtered = filterVehicle ? records.filter(r => r.vehicleName === filterVehicle) : records;

  if (filtered.length === 0) {
    if (emptyState) emptyState.classList.remove('d-none');
    _getMaintPaginator().update([]);
    return;
  }
  if (emptyState) emptyState.classList.add('d-none');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const manualOdo = store.get('manualOdo') ?? {};
  const tripOdo = {};
  (store.get('tripLogs') ?? []).forEach(l => {
    if (!tripOdo[l.vehicleName] || l.odoReading > tripOdo[l.vehicleName])
      tripOdo[l.vehicleName] = l.odoReading;
  });
  const maintOdo = {};
  records.forEach(r => {
    if (!maintOdo[r.vehicleName] || r.odoReading > maintOdo[r.vehicleName])
      maintOdo[r.vehicleName] = r.odoReading;
  });
  const getCurrentOdo = (vName) => manualOdo[vName] ?? (Math.max(tripOdo[vName] ?? 0, maintOdo[vName] ?? 0) || null);

  const historyMap = {};
  filtered.forEach(r => {
    const key = `${r.vehicleName}__${r.type}`;
    if (!historyMap[key]) historyMap[key] = [];
    historyMap[key].push(r);
  });
  Object.values(historyMap).forEach(arr => arr.sort((a, b) => a.date.localeCompare(b.date)));

  const byVehicle = {};
  filtered.forEach(r => {
    if (!byVehicle[r.vehicleName]) byVehicle[r.vehicleName] = {};
    byVehicle[r.vehicleName][r.type] = r;
  });

  const vehicleGroups = Object.entries(byVehicle).map(([vName, typeMap]) => ({
    vName, typeMap, historyMap, getCurrentOdo, manualOdo, tripOdo, today,
  }));

  _getMaintPaginator().update(vehicleGroups);
}

function _renderMaintenanceSlice(container, slice) {
  container.innerHTML = slice.map(({ vName, typeMap, historyMap, getCurrentOdo, manualOdo, tripOdo, today }) => {
    const recs = Object.values(typeMap);
    const curOdo = getCurrentOdo(vName);
    const odoSource = manualOdo[vName] ? 'manual' : tripOdo[vName] ? 'trip log' : null;

    const odoBar = `
      <div class="maint-odo-bar">
        <div class="maint-odo-info">
          <i class="bi bi-speedometer2 me-1"></i>
          <span class="maint-odo-label">Current ODO:</span>
          <span class="maint-odo-value" id="maint-odo-display-${escapeHtml(vName)}">${curOdo != null ? curOdo.toLocaleString('en-IN') + ' km' : 'Not set'}</span>
          ${odoSource ? `<span class="maint-odo-source">(${odoSource})</span>` : ''}
        </div>
        <div class="maint-odo-update">
          <input type="number" class="form-control form-control-sm maint-odo-input"
            id="maint-odo-input-${escapeHtml(vName)}"
            placeholder="Update ODO…" min="0"
            value="${curOdo ?? ''}"
            style="width:130px" />
          <button class="btn btn-sm btn-outline-primary maint-odo-save"
            data-vehicle="${escapeHtml(vName)}">
            <i class="bi bi-check-lg"></i> Update
          </button>
        </div>
      </div>`;

    const cards = recs.sort((a, b) => b.date.localeCompare(a.date)).map(r => {
      const effectiveOdo = curOdo ?? r.odoReading;
      const doneDate = new Date(r.date);
      const nextKm   = r.intervalKm   > 0 ? r.odoReading + r.intervalKm   : null;
      const nextDate = r.intervalDays > 0 ? new Date(doneDate.getTime() + r.intervalDays * 86400000) : null;

      const kmLeft   = nextKm   ? nextKm - effectiveOdo : null;
      const daysLeft = nextDate ? Math.round((nextDate - today) / 86400000) : null;

      let status = 'ok';
      if ((kmLeft !== null && kmLeft <= 0) || (daysLeft !== null && daysLeft <= 0)) {
        status = 'overdue';
      } else if (nextKm && nextDate) {
        if (kmLeft <= 300 && daysLeft <= 14) status = 'due-soon';
      } else if (kmLeft !== null && kmLeft <= 300) {
        status = 'due-soon';
      } else if (daysLeft !== null && daysLeft <= 14) {
        status = 'due-soon';
      }

      const statusBadge = status === 'overdue'
        ? `<span class="badge bg-danger">Overdue</span>`
        : status === 'due-soon'
        ? `<span class="badge bg-warning text-dark">Due Soon</span>`
        : `<span class="badge bg-success">OK</span>`;

      const nextKmHtml = nextKm
        ? `<div class="maint-stat"><span class="maint-stat-label">Next at</span><span class="maint-stat-value">${nextKm.toLocaleString('en-IN')} km</span></div>
           <div class="maint-stat"><span class="maint-stat-label">km left</span><span class="maint-stat-value ${kmLeft <= 0 ? 'text-danger' : kmLeft <= 300 ? 'text-warning' : 'text-success'}">${kmLeft > 0 ? '+' + kmLeft.toLocaleString('en-IN') + ' km' : 'Overdue'}</span></div>`
        : '';
      const nextDateHtml = nextDate
        ? `<div class="maint-stat"><span class="maint-stat-label">Due date</span><span class="maint-stat-value">${nextDate.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</span></div>
           <div class="maint-stat"><span class="maint-stat-label">Days left</span><span class="maint-stat-value ${daysLeft <= 0 ? 'text-danger' : daysLeft <= 14 ? 'text-warning' : 'text-success'}">${daysLeft > 0 ? '+' + daysLeft + 'd' : 'Overdue'}</span></div>`
        : '';

      const historyKey = `${vName}__${r.type}`;
      const history = (historyMap[historyKey] ?? []).filter(h => h.id !== r.id);
      const historyHtml = history.length > 0 ? `
        <div class="maint-history-toggle" data-history-key="${escapeHtml(historyKey)}">
          <i class="bi bi-clock-history me-1"></i>${history.length} previous completion${history.length > 1 ? 's' : ''}
          <i class="bi bi-chevron-down ms-1 maint-history-chevron"></i>
        </div>
        <div class="maint-history-list d-none" id="maint-hist-${escapeHtml(historyKey)}">
          ${history.slice().reverse().map(h => `
            <div class="maint-history-row">
              <i class="bi bi-check-circle-fill text-success me-2"></i>
              <span>${h.date}</span>
              <span class="text-muted mx-2">·</span>
              <span>${h.odoReading.toLocaleString('en-IN')} km</span>
              ${h.notes ? `<span class="text-muted mx-2">·</span><span class="text-muted">${escapeHtml(h.notes)}</span>` : ''}
            </div>`).join('')}
        </div>` : '';

      return `
        <div class="maint-card status-${status}">
          <div class="maint-card-header">
            <div class="maint-icon"><i class="bi bi-tools"></i></div>
            <div class="maint-info">
              <div class="maint-type">${escapeHtml(r.type)}</div>
              <div class="maint-meta">Done ${r.date} · at ${r.odoReading.toLocaleString('en-IN')} km${r.notes ? ' · ' + escapeHtml(r.notes) : ''}</div>
            </div>
            <div class="d-flex align-items-center gap-2">
              ${statusBadge}
              <button class="btn btn-sm btn-outline-success maint-complete-btn" data-complete-maint="${escapeHtml(r.id)}" title="Mark as completed today"><i class="bi bi-check-circle-fill"></i></button>
              <button class="btn btn-sm btn-outline-primary" data-edit-maint="${escapeHtml(r.id)}"><i class="bi bi-pencil-fill"></i></button>
              <button class="btn btn-sm btn-outline-danger" data-delete-maint="${escapeHtml(r.id)}"><i class="bi bi-trash-fill"></i></button>
            </div>
          </div>
          <div class="maint-stats">
            <div class="maint-stat"><span class="maint-stat-label">Done at</span><span class="maint-stat-value">${r.odoReading.toLocaleString('en-IN')} km</span></div>
            ${nextKmHtml}
            ${nextDateHtml}
          </div>
          ${historyHtml}
        </div>`;
    }).join('');

    return `<div class="maint-vehicle-group mb-3">
      <div class="maint-vehicle-label"><i class="bi bi-car-front-fill me-1"></i>${escapeHtml(vName)}</div>
      ${odoBar}
      ${cards}
    </div>`;
  }).join('');

  // Bind ODO update buttons
  container.querySelectorAll('.maint-odo-save').forEach(btn => {
    btn.addEventListener('click', () => {
      const vName = btn.dataset.vehicle;
      const input = document.getElementById(`maint-odo-input-${vName}`);
      const val = parseFloat(input?.value);
      if (!val || val <= 0) return;
      const current = store.get('manualOdo') ?? {};
      current[vName] = val;
      store.set('manualOdo', current);
      // Re-render immediately
      renderMaintenance();
    });
  });

  container.querySelectorAll('[data-edit-maint]').forEach(btn =>
    btn.addEventListener('click', () => _startEditMaintenance(btn.dataset.editMaint)));
  container.querySelectorAll('[data-delete-maint]').forEach(btn =>
    btn.addEventListener('click', () => _deleteMaintenance(btn.dataset.deleteMaint)));
  container.querySelectorAll('[data-complete-maint]').forEach(btn =>
    btn.addEventListener('click', () => _completeMaintenance(btn.dataset.completeMaint)));
  container.querySelectorAll('.maint-history-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const key = toggle.dataset.historyKey;
      const list = document.getElementById(`maint-hist-${key}`);
      const chevron = toggle.querySelector('.maint-history-chevron');
      if (list) list.classList.toggle('d-none');
      if (chevron) chevron.classList.toggle('bi-chevron-down');
      if (chevron) chevron.classList.toggle('bi-chevron-up');
    });
  });
}

async function _completeMaintenance(id) {
  const rec = (store.get('maintenance') ?? []).find(r => r.id === id);
  if (!rec) return;

  // Populate and show the modal
  const modal = document.getElementById('maint-complete-modal');
  const typeLabel = document.getElementById('maint-complete-type-label');
  const odoInput = document.getElementById('maint-complete-odo');
  const errorEl = document.getElementById('maint-complete-error');
  const confirmBtn = document.getElementById('maint-complete-confirm');
  if (!modal || !odoInput || !confirmBtn) return;

  if (typeLabel) typeLabel.textContent = `${rec.type} · ${rec.vehicleName}`;
  odoInput.value = '';
  if (errorEl) errorEl.classList.add('d-none');

  // Pre-fill intervals with existing values
  const intervalKmInput = document.getElementById('maint-complete-interval-km');
  const intervalDaysInput = document.getElementById('maint-complete-interval-days');
  if (intervalKmInput) intervalKmInput.value = rec.intervalKm || '';
  if (intervalDaysInput) intervalDaysInput.value = rec.intervalDays || '';

  const bsModal = bootstrap.Modal.getOrCreateInstance(modal);
  bsModal.show();

  // Remove any previous listener to avoid stacking
  const newConfirmBtn = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

  newConfirmBtn.addEventListener('click', async () => {
    const odoReading = parseFloat(odoInput.value);
    if (!odoReading || odoReading <= 0) {
      if (errorEl) { errorEl.textContent = 'Please enter a valid odometer reading.'; errorEl.classList.remove('d-none'); }
      return;
    }
    if (errorEl) errorEl.classList.add('d-none');

    const intervalKmInput = document.getElementById('maint-complete-interval-km');
    const intervalDaysInput = document.getElementById('maint-complete-interval-days');
    const intervalKm   = parseFloat(intervalKmInput?.value)   || rec.intervalKm;
    const intervalDays = parseFloat(intervalDaysInput?.value) || rec.intervalDays;

    const today = new Date().toISOString().slice(0, 10);
    const newRecord = {
      id: crypto.randomUUID(),
      vehicleName: rec.vehicleName,
      type: rec.type,
      date: today,
      odoReading,
      intervalKm,
      intervalDays,
      notes: rec.notes,
    };

    try {
      // Update manualOdo so the ODO bar in maintenance section reflects the new reading
      const manualOdo = store.get('manualOdo') ?? {};
      manualOdo[rec.vehicleName] = odoReading;
      store.set('manualOdo', manualOdo);

      const records = [...(store.get('maintenance') ?? []), newRecord];
      await writeAllRows(CONFIG.sheets.maintenance, records.map(serializeMaintenance));
      store.set('maintenance', records);
      bsModal.hide();
    } catch (err) {
      if (errorEl) { errorEl.textContent = err.message ?? 'Failed to save.'; errorEl.classList.remove('d-none'); }
    }
  });
}

function _startEditMaintenance(id) {
  const rec = (store.get('maintenance') ?? []).find(r => r.id === id);
  if (!rec) return;
  _editingMaintenanceId = id;
  document.getElementById('maint-vehicle').value = rec.vehicleName;
  // Set type — if not in preset list, use custom
  const typeSel = document.getElementById('maint-type');
  const presets = Array.from(typeSel.options).map(o => o.value);
  if (presets.includes(rec.type)) {
    typeSel.value = rec.type;
    document.getElementById('maint-custom-wrap').classList.add('d-none');
  } else {
    typeSel.value = '__custom__';
    document.getElementById('maint-custom-wrap').classList.remove('d-none');
    document.getElementById('maint-custom-type').value = rec.type;
  }
  document.getElementById('maint-date').value = rec.date;
  document.getElementById('maint-odo').value = rec.odoReading;
  document.getElementById('maint-interval-km').value = rec.intervalKm || '';
  document.getElementById('maint-interval-days').value = rec.intervalDays || '';
  document.getElementById('maint-notes').value = rec.notes || '';
  const cancelBtn = document.getElementById('maintenance-cancel-edit');
  if (cancelBtn) cancelBtn.classList.remove('d-none');
  bootstrap.Modal.getOrCreateInstance(document.getElementById('oc-maintenance')).show();
}

async function _deleteMaintenance(id) {
  if (!await epConfirm('Delete this maintenance record?', 'Delete Record', 'Delete')) return;
  const allRecords = store.get('maintenance') ?? [];
  const deleted = allRecords.find(r => r.id === id);
  const records = allRecords.filter(r => r.id !== id);
  await writeAllRows(CONFIG.sheets.maintenance, records.map(serializeMaintenance));
  store.set('maintenance', records);
  const { showUndoToast } = await import('./undo.js');
  showUndoToast('Maintenance record deleted', async () => {
    const current = [...(store.get('maintenance') ?? []), deleted];
    await writeAllRows(CONFIG.sheets.maintenance, current.map(serializeMaintenance));
    store.set('maintenance', current);
  });
}

function _bindMaintenanceForm() {
  // Populate vehicle dropdown in maintenance modal
  const modal = document.getElementById('oc-maintenance');
  if (modal) {
    modal.addEventListener('show.bs.modal', () => {
      const sel = document.getElementById('maint-vehicle');
      if (!sel) return;
      const vehicles = store.get('vehicles') ?? [];
      const cur = sel.value;
      sel.innerHTML = '<option value="">Select vehicle…</option>' +
        vehicles.map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)}</option>`).join('');
      if (cur) sel.value = cur;
    });
  }

  // Show/hide custom type input
  const typeSel = document.getElementById('maint-type');
  if (typeSel) {
    typeSel.addEventListener('change', () => {
      const wrap = document.getElementById('maint-custom-wrap');
      if (wrap) wrap.classList.toggle('d-none', typeSel.value !== '__custom__');
    });
  }

  const form = document.getElementById('maintenance-form');
  if (!form) return;

  const cancelBtn = document.getElementById('maintenance-cancel-edit');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      _editingMaintenanceId = null;
      form.reset();
      document.getElementById('maint-custom-wrap')?.classList.add('d-none');
      cancelBtn.classList.add('d-none');
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const vehicleName  = document.getElementById('maint-vehicle')?.value ?? '';
    const typeRaw      = document.getElementById('maint-type')?.value ?? '';
    const customType   = document.getElementById('maint-custom-type')?.value?.trim() ?? '';
    const type         = typeRaw === '__custom__' ? customType : typeRaw;
    const date         = document.getElementById('maint-date')?.value ?? '';
    const odoReading   = parseFloat(document.getElementById('maint-odo')?.value) || 0;
    const intervalKm   = parseFloat(document.getElementById('maint-interval-km')?.value) || 0;
    const intervalDays = parseFloat(document.getElementById('maint-interval-days')?.value) || 0;
    const notes        = document.getElementById('maint-notes')?.value?.trim() ?? '';

    const errEl = document.getElementById('maintenance-error-banner');
    const showErr = (msg) => { if (errEl) { errEl.textContent = msg; errEl.classList.remove('d-none'); } };
    const hideErr = () => { if (errEl) errEl.classList.add('d-none'); };

    if (!vehicleName || !type || !date || !odoReading) { showErr('Vehicle, type, date and odometer are required.'); return; }
    hideErr();

    const id = _editingMaintenanceId ?? crypto.randomUUID();
    const record = { id, vehicleName, type, date, odoReading, intervalKm, intervalDays, notes };

    try {
      let records = store.get('maintenance') ?? [];
      records = _editingMaintenanceId
        ? records.map(r => r.id === _editingMaintenanceId ? record : r)
        : [...records, record];
      await writeAllRows(CONFIG.sheets.maintenance, records.map(serializeMaintenance));
      store.set('maintenance', records);
      _editingMaintenanceId = null;
      form.reset();
      document.getElementById('maint-custom-wrap')?.classList.add('d-none');
      if (cancelBtn) cancelBtn.classList.add('d-none');
      bootstrap.Modal.getInstance(document.getElementById('oc-maintenance'))?.hide();
    } catch (err) { showErr(err.message ?? 'Failed to save.'); }
  });
}

// ─── Vehicle Documents ────────────────────────────────────────────────────────

export function renderVehicleDocuments() {
  const container = document.getElementById('vehicle-documents-cards');
  if (!container) return;

  const docs = store.get('vehicleDocuments') ?? [];
  const vehicles = store.get('vehicles') ?? [];

  if (vehicles.length === 0) {
    container.innerHTML = '<p class="text-muted small">No vehicles added yet.</p>';
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function docStatus(dateStr) {
    if (!dateStr) return 'unknown';
    const d = new Date(dateStr);
    if (isNaN(d)) return 'unknown';
    const daysLeft = Math.round((d - today) / 86400000);
    if (daysLeft < 0) return 'expired';
    if (daysLeft <= 30) return 'due-soon';
    return 'ok';
  }

  function statusBadge(dateStr) {
    const s = docStatus(dateStr);
    if (s === 'expired')  return `<span class="badge bg-danger">Expired</span>`;
    if (s === 'due-soon') return `<span class="badge bg-warning text-dark">Due Soon</span>`;
    if (s === 'ok')       return `<span class="badge bg-success">OK</span>`;
    return `<span class="badge bg-secondary">Not Set</span>`;
  }

  const docMap = {};
  docs.forEach(d => { docMap[d.vehicleName] = d; });

  container.innerHTML = `<div class="rc-cards-grid">${vehicles.map(v => {
    const doc = docMap[v.name] ?? {};
    const status = docStatus(doc.rcExpiry);
    const statusClass = status === 'expired' ? 'rc-expired' : status === 'due-soon' ? 'rc-due-soon' : 'rc-valid';
    const statusIcon = status === 'expired' ? 'bi-exclamation-circle-fill' : status === 'due-soon' ? 'bi-clock-fill' : 'bi-check-circle-fill';
    const statusText = status === 'expired' ? 'Expired' : status === 'due-soon' ? 'Due Soon' : 'Valid';
    
    return `
      <div class="rc-card ${statusClass}">
        <div class="rc-card-header">
          <div class="rc-vehicle-info">
            <div class="rc-vehicle-icon">
              <i class="bi ${VEHICLE_ICONS[v.type] ?? VEHICLE_ICONS.default}"></i>
            </div>
            <div class="rc-vehicle-details">
              <h4 class="rc-vehicle-name">${escapeHtml(v.name)}</h4>
              <p class="rc-vehicle-meta">${escapeHtml(v.type)}${v.regNumber ? ' · ' + escapeHtml(v.regNumber) : ''}</p>
            </div>
          </div>
          <div class="rc-status-indicator">
            <i class="bi ${statusIcon}"></i>
          </div>
        </div>
        
        <div class="rc-card-body">
          <div class="rc-expiry-section">
            <div class="rc-expiry-label">
              <i class="bi bi-calendar-event me-2"></i>RC Expiry Date
            </div>
            <div class="rc-expiry-info">
              <span class="rc-expiry-date">${doc.rcExpiry ? formatDate(doc.rcExpiry) : 'Not Set'}</span>
              <span class="rc-status-badge ${statusClass}">${statusText}</span>
            </div>
          </div>
          
          ${doc.rcExpiry ? `
            <div class="rc-days-remaining">
              ${status === 'expired' 
                ? `<span class="rc-expired-text">Expired ${Math.abs(Math.round((new Date(doc.rcExpiry) - today) / 86400000))} days ago</span>`
                : status === 'due-soon'
                ? `<span class="rc-due-text">${Math.round((new Date(doc.rcExpiry) - today) / 86400000)} days remaining</span>`
                : `<span class="rc-valid-text">${Math.round((new Date(doc.rcExpiry) - today) / 86400000)} days remaining</span>`
              }
            </div>
          ` : ''}
        </div>
        
        <div class="rc-card-footer">
          <button class="rc-update-btn" onclick="openVehicleDocModal('${escapeHtml(v.name)}', '${doc.rcExpiry || ''}')">
            <i class="bi bi-pencil-square me-2"></i>Update RC
          </button>
        </div>
      </div>`;
  }).join('')}</div>`;
}

// Open vehicle document modal with pre-filled data
window.openVehicleDocModal = function(vehicleName, rcExpiry) {
  const modal = document.getElementById('oc-vehicle-doc');
  if (!modal) return;
  
  const vehicleSelect = document.getElementById('vdoc-vehicle');
  const rcExpiryInput = document.getElementById('vdoc-rc-expiry');
  
  if (vehicleSelect) {
    vehicleSelect.value = vehicleName;
  }
  
  if (rcExpiryInput) {
    rcExpiryInput.value = rcExpiry;
  }
  
  const bsModal = new bootstrap.Modal(modal);
  bsModal.show();
}

function _bindVehicleDocForm() {
  const modal = document.getElementById('oc-vehicle-doc');
  if (modal) {
    modal.addEventListener('show.bs.modal', () => {
      const sel = document.getElementById('vdoc-vehicle');
      if (!sel) return;
      const vehicles = store.get('vehicles') ?? [];
      const cur = sel.value;
      sel.innerHTML = '<option value="">Select vehicle…</option>' +
        vehicles.map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)}</option>`).join('');
      if (cur) sel.value = cur;
    });
  }

  const form = document.getElementById('vehicle-doc-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const vehicleName     = document.getElementById('vdoc-vehicle')?.value ?? '';
    const rcExpiry        = document.getElementById('vdoc-rc-expiry')?.value ?? '';
    const errEl = document.getElementById('vdoc-error-banner');
    if (!vehicleName) {
      if (errEl) { errEl.textContent = 'Please select a vehicle.'; errEl.classList.remove('d-none'); }
      return;
    }
    if (errEl) errEl.classList.add('d-none');

    const record = { vehicleName, insuranceExpiry: '', rcExpiry };
    try {
      let docs = store.get('vehicleDocuments') ?? [];
      const idx = docs.findIndex(d => d.vehicleName === vehicleName);
      if (idx !== -1) {
        docs = docs.map((d, i) => i === idx ? record : d);
      } else {
        docs = [...docs, record];
      }
      await writeAllRows(CONFIG.sheets.vehicleDocuments, docs.map(serializeVehicleDoc));
      store.set('vehicleDocuments', docs);
      form.reset();
      if (modal) bootstrap.Modal.getInstance(modal)?.hide();
    } catch (err) {
      if (errEl) { errEl.textContent = err.message ?? 'Failed to save.'; errEl.classList.remove('d-none'); }
    }
  });
}

// ─── Insurance Policies ───────────────────────────────────────────────────────

let _editingInsuranceId = null;

export function renderInsurancePolicies() {
  const container = document.getElementById('insurance-policies-list');
  if (!container) return;

  const policies = store.get('vehicleInsurance') ?? [];
  const vehicles = store.get('vehicles') ?? [];

  if (vehicles.length === 0) {
    container.innerHTML = '<p class="text-muted small">No vehicles added yet.</p>';
    return;
  }

  if (policies.length === 0) {
    container.innerHTML = '<div class="ep-empty-state"><div class="ep-es-icon-wrap" style="background:linear-gradient(135deg,#10b981,#059669);box-shadow:0 8px 32px rgba(16,185,129,.3)"><i class="bi bi-shield-check"></i></div><div class="ep-es-title">No insurance policies</div><div class="ep-es-subtitle">Add insurance policies for your vehicles and get reminders before they expire.</div><button class="btn ep-es-cta" style="background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none" data-bs-toggle="modal" data-bs-target="#oc-insurance-policy"><i class="bi bi-plus-circle-fill me-2"></i>Add First Policy</button></div>';
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function daysLeft(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    return isNaN(d) ? null : Math.round((d - today) / 86400000);
  }

  function statusInfo(dateStr) {
    const dl = daysLeft(dateStr);
    if (dl === null) return { badge: `<span class="badge bg-secondary">Unknown</span>`, cls: '', urgency: '' };
    if (dl < 0)      return { badge: `<span class="badge bg-danger">Expired</span>`, cls: 'ins-card--expired', urgency: `<span class="ins-days ins-days--expired"><i class="bi bi-exclamation-triangle-fill me-1"></i>Expired ${Math.abs(dl)}d ago</span>` };
    if (dl <= 30)    return { badge: `<span class="badge bg-warning text-dark">Expiring Soon</span>`, cls: 'ins-card--soon', urgency: `<span class="ins-days ins-days--soon"><i class="bi bi-clock-fill me-1"></i>${dl}d left</span>` };
    return { badge: `<span class="badge bg-success">Active</span>`, cls: '', urgency: `<span class="ins-days ins-days--ok"><i class="bi bi-check-circle-fill me-1"></i>${dl}d left</span>` };
  }

  const TYPE_ICON = {
    'Third Party': 'bi-person-fill-check',
    'Comprehensive': 'bi-shield-fill-check',
    'Zero Depreciation': 'bi-shield-fill-plus',
    'Personal Accident': 'bi-heart-pulse-fill',
    'Other': 'bi-shield-fill',
  };
  const TYPE_COLOR = {
    'Third Party': '#0ea5e9',
    'Comprehensive': '#10b981',
    'Zero Depreciation': '#6366f1',
    'Personal Accident': '#f59e0b',
    'Other': '#64748b',
  };

  _getInsurancePaginator(); // keep paginator initialized for pagination nav

  // Render directly
  const paginatorContainer = document.getElementById('insurance-policies-list');
  if (!paginatorContainer) return;

  paginatorContainer.innerHTML = `<div class="ins-grid">${policies.map(p => {
    const { badge, cls, urgency } = statusInfo(p.expiryDate);
    const color = TYPE_COLOR[p.policyType] ?? '#64748b';
    const icon  = TYPE_ICON[p.policyType] ?? 'bi-shield-fill';
    return `
      <div class="ins-card ${cls}">
        <div class="ins-card-top">
          <div class="ins-icon" style="background:${color}20;color:${color}">
            <i class="bi ${icon}"></i>
          </div>
          <div class="ins-info">
            <div class="ins-vehicle">${escapeHtml(p.vehicleName)}</div>
            <div class="ins-type" style="color:${color}">${escapeHtml(p.policyType || '—')}</div>
          </div>
          <div class="ins-badge-wrap">
            ${badge}
          </div>
        </div>

        <div class="ins-details">
          ${p.provider ? `<div class="ins-detail-row"><i class="bi bi-building me-1 text-muted"></i><span class="ins-detail-label">Provider</span><span class="ins-detail-val">${escapeHtml(p.provider)}</span></div>` : ''}
          ${p.policyNumber ? `<div class="ins-detail-row"><i class="bi bi-hash me-1 text-muted"></i><span class="ins-detail-label">Policy No.</span><span class="ins-detail-val">${escapeHtml(p.policyNumber)}</span></div>` : ''}
          <div class="ins-detail-row"><i class="bi bi-calendar-event me-1 text-muted"></i><span class="ins-detail-label">Expires</span><span class="ins-detail-val">${p.expiryDate || '—'}</span></div>
          ${p.premiumAmount > 0 ? `<div class="ins-detail-row"><i class="bi bi-currency-rupee me-1 text-muted"></i><span class="ins-detail-label">Premium</span><span class="ins-detail-val fw-semibold" style="color:${color}">${formatCurrency(p.premiumAmount)}</span></div>` : ''}
        </div>

        <div class="ins-footer">
          ${urgency}
          <div class="dc-actions ms-auto">
            <button class="btn btn-sm btn-outline-primary" data-edit-insurance="${escapeHtml(p.id)}" title="Edit"><i class="bi bi-pencil-fill"></i></button>
            <button class="btn btn-sm btn-outline-danger" data-delete-insurance="${escapeHtml(p.id)}" title="Delete"><i class="bi bi-trash-fill"></i></button>
          </div>
        </div>
      </div>`;
  }).join('')}</div>`;

  paginatorContainer.querySelectorAll('[data-edit-insurance]').forEach(btn =>
    btn.addEventListener('click', () => _startEditInsurance(btn.dataset.editInsurance)));
  paginatorContainer.querySelectorAll('[data-delete-insurance]').forEach(btn =>
    btn.addEventListener('click', () => _deleteInsurance(btn.dataset.deleteInsurance)));
}

function _startEditInsurance(id) {
  const policies = store.get('vehicleInsurance') ?? [];
  const policy = policies.find(p => p.id === id);
  if (!policy) return;

  _editingInsuranceId = id;
  document.getElementById('insurance-vehicle').value = policy.vehicleName;
  document.getElementById('insurance-policy-type').value = policy.policyType;
  document.getElementById('insurance-provider').value = policy.provider ?? '';
  document.getElementById('insurance-policy-number').value = policy.policyNumber ?? '';
  document.getElementById('insurance-expiry-date').value = policy.expiryDate ?? '';
  document.getElementById('insurance-premium-amount').value = policy.premiumAmount ?? '';

  const modal = document.getElementById('oc-insurance-policy');
  const title = document.getElementById('oc-insurance-policy-label');
  if (title) title.innerHTML = '<i class="bi bi-shield-check text-success me-2"></i>Edit Insurance Policy';
  if (modal) bootstrap.Modal.getOrCreateInstance(modal).show();
}

async function _deleteInsurance(id) {
  const confirmed = await epConfirm('Delete this insurance policy?');
  if (!confirmed) return;

  try {
    const allPolicies = store.get('vehicleInsurance') ?? [];
    const deleted = allPolicies.find(p => p.id === id);
    const policies = allPolicies.filter(p => p.id !== id);
    await writeAllRows(CONFIG.sheets.vehicleInsurance, policies.map(serializeInsurance));
    store.set('vehicleInsurance', policies);
    const { showUndoToast } = await import('./undo.js');
    showUndoToast('Insurance policy deleted', async () => {
      const current = [...(store.get('vehicleInsurance') ?? []), deleted];
      await writeAllRows(CONFIG.sheets.vehicleInsurance, current.map(serializeInsurance));
      store.set('vehicleInsurance', current);
    });
  } catch (err) {
    alert(err.message ?? 'Failed to delete insurance policy.');
  }
}

function _bindInsurancePolicyForm() {
  const modal = document.getElementById('oc-insurance-policy');
  if (modal) {
    modal.addEventListener('show.bs.modal', () => {
      const sel = document.getElementById('insurance-vehicle');
      if (!sel) return;
      const vehicles = store.get('vehicles') ?? [];
      const cur = sel.value;
      sel.innerHTML = '<option value="">Select vehicle…</option>' +
        vehicles.map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)}</option>`).join('');
      if (cur) sel.value = cur;
    });

    modal.addEventListener('hidden.bs.modal', () => {
      _editingInsuranceId = null;
      const title = document.getElementById('oc-insurance-policy-label');
      if (title) title.innerHTML = '<i class="bi bi-shield-check text-success me-2"></i>Add Insurance Policy';
      document.getElementById('insurance-policy-form')?.reset();
      const errEl = document.getElementById('insurance-error-banner');
      if (errEl) errEl.classList.add('d-none');
    });
  }

  const form = document.getElementById('insurance-policy-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const vehicleName = document.getElementById('insurance-vehicle')?.value ?? '';
    const policyType = document.getElementById('insurance-policy-type')?.value ?? '';
    const provider = document.getElementById('insurance-provider')?.value?.trim() ?? '';
    const policyNumber = document.getElementById('insurance-policy-number')?.value?.trim() ?? '';
    const expiryDate = document.getElementById('insurance-expiry-date')?.value ?? '';
    const premiumAmount = parseFloat(document.getElementById('insurance-premium-amount')?.value) || 0;

    const errEl = document.getElementById('insurance-error-banner');
    if (!vehicleName) {
      if (errEl) { errEl.textContent = 'Please select a vehicle.'; errEl.classList.remove('d-none'); }
      return;
    }
    if (!policyType) {
      if (errEl) { errEl.textContent = 'Please select a policy type.'; errEl.classList.remove('d-none'); }
      return;
    }
    if (!expiryDate) {
      if (errEl) { errEl.textContent = 'Please enter an expiry date.'; errEl.classList.remove('d-none'); }
      return;
    }
    if (errEl) errEl.classList.add('d-none');

    try {
      let policies = store.get('vehicleInsurance') ?? [];
      if (_editingInsuranceId) {
        policies = policies.map(p => p.id === _editingInsuranceId 
          ? { id: _editingInsuranceId, vehicleName, policyType, provider, policyNumber, expiryDate, premiumAmount }
          : p);
      } else {
        const id = crypto.randomUUID();
        policies = [...policies, { id, vehicleName, policyType, provider, policyNumber, expiryDate, premiumAmount }];
      }
      await writeAllRows(CONFIG.sheets.vehicleInsurance, policies.map(serializeInsurance));
      store.set('vehicleInsurance', policies);
      form.reset();
      if (modal) bootstrap.Modal.getInstance(modal)?.hide();
    } catch (err) {
      if (errEl) { errEl.textContent = err.message ?? 'Failed to save policy.'; errEl.classList.remove('d-none'); }
    }
  });
}

// ─── init ─────────────────────────────────────────────────────────────────────

export function init() {
  _bindVehicleForm();
  _bindTripLogForm();
  _bindVehicleExpenseForm();
  _bindMaintenanceForm();
  _bindVehicleDocForm();
  _bindInsurancePolicyForm();
  const filterSel = document.getElementById('vehicle-filter-select');
  if (filterSel) filterSel.addEventListener('change', () => { renderTripLogs(); renderVehicleExpenses(); renderMaintenance(); });
  // Bind type→value dependency for vehicle expense payment method
  const veTypeSel = document.getElementById('ve-payment-type');
  if (veTypeSel) veTypeSel.addEventListener('change', _refreshVePaymentMethods);
  store.on('vehicles',            () => { _populateVehicleDropdowns(); renderVehicleList(); renderMonthlySummary(); renderVehicleDocuments(); renderInsurancePolicies(); });
  store.on('tripLogs',            () => { renderTripLogs(); renderMonthlySummary(); renderMaintenance(); const statEl = document.getElementById('veh-stat-trips'); if (statEl) statEl.textContent = (store.get('tripLogs') ?? []).length; });
  store.on('vehicleExpenses',     () => renderVehicleExpenses());
  store.on('maintenance',         () => renderMaintenance());
  store.on('manualOdo',           () => renderMaintenance());
  store.on('vehicleDocuments',    () => renderVehicleDocuments());
  store.on('vehicleInsurance',    () => renderInsurancePolicies());
  store.on('accounts',            _refreshVePaymentMethods);
  store.on('creditCards',         _refreshVePaymentMethods);
  store.on('vehicleExpenseTypes', _refreshVeExpenseTypes);
}
