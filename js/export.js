// js/export.js — CSV and print-PDF export for expenses and income
import * as store from './store.js';
import { formatCurrency } from './utils.js';

function _escapeCsv(val) {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function _rowToCsv(arr) {
  return arr.map(_escapeCsv).join(',');
}

function _download(filename, content, mime = 'text/csv') {
  const blob = new Blob([content], { type: mime + ';charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Expenses CSV ─────────────────────────────────────────────────────────────

export function exportExpensesCsv(filtered) {
  const rows = filtered ?? store.get('expenses') ?? [];
  const header = _rowToCsv(['Date', 'Category', 'Sub-Category', 'Amount', 'Description', 'Payment Method']);
  const lines  = rows.map(r => _rowToCsv([r.date, r.category, r.subCategory ?? '', r.amount, r.description, r.paymentMethod]));
  _download('expenses.csv', [header, ...lines].join('\r\n'));
}

// ─── Income CSV ───────────────────────────────────────────────────────────────

export function exportIncomeCsv(filtered) {
  const rows = filtered ?? store.get('income') ?? [];
  const header = _rowToCsv(['Date', 'Source', 'Amount', 'Description', 'Received In']);
  const lines  = rows.map(r => _rowToCsv([r.date, r.source, r.amount, r.description, r.receivedIn ?? '']));
  _download('income.csv', [header, ...lines].join('\r\n'));
}

// ─── Print PDF (uses browser print dialog) ────────────────────────────────────

export function exportExpensesPdf(filtered, periodLabel) {
  const rows = filtered ?? store.get('expenses') ?? [];
  _printTable(
    'Expense Report' + (periodLabel ? ' — ' + periodLabel : ''),
    ['Date', 'Category', 'Sub-Category', 'Amount', 'Description', 'Payment Method'],
    rows.map(r => [r.date, r.category, r.subCategory ?? '—', formatCurrency(r.amount), r.description, r.paymentMethod]),
    rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  );
}

export function exportIncomePdf(filtered, periodLabel) {
  const rows = filtered ?? store.get('income') ?? [];
  _printTable(
    'Income Report' + (periodLabel ? ' — ' + periodLabel : ''),
    ['Date', 'Source', 'Amount', 'Description', 'Received In'],
    rows.map(r => [r.date, r.source, formatCurrency(r.amount), r.description, r.receivedIn ?? '—']),
    rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  );
}

function _printTable(title, headers, rows, total) {
  const css = `
    body { font-family: Arial, sans-serif; font-size: 12px; color: #1e293b; }
    h2   { font-size: 16px; margin-bottom: 4px; }
    p    { font-size: 11px; color: #64748b; margin: 0 0 12px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #6366f1; color: #fff; padding: 7px 10px; text-align: left; font-size: 11px; }
    td { padding: 6px 10px; border-bottom: 1px solid #e2e8f0; }
    tr:nth-child(even) td { background: #f8fafc; }
    .total { font-weight: bold; padding: 8px 10px; text-align: right; }
  `;
  const thead = '<tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr>';
  const tbody = rows.map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('');
  const tfoot = `<tr><td colspan="${headers.length - 1}" class="total">Total</td><td class="total">${formatCurrency(total)}</td></tr>`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head>
    <body>
      <h2>${title}</h2>
      <p>Generated: ${new Date().toLocaleString()}</p>
      <table><thead>${thead}</thead><tbody>${tbody}</tbody><tfoot>${tfoot}</tfoot></table>
    </body></html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}
