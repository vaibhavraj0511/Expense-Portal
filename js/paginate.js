// js/paginate.js — Shared pagination utility

/**
 * Creates a pagination controller for a list container.
 *
 * @param {object} opts
 * @param {string}   opts.containerId   - ID of the element that holds the rendered rows/cards
 * @param {string}   opts.paginationId  - ID of the <nav> element for page buttons
 * @param {number}  [opts.pageSize=10]  - Items per page
 * @param {function} opts.renderPage    - Called with (items, startIndex) — renders the current page slice
 * @returns {{ update(items: any[]): void }}  Call update() whenever the data changes
 */
export function createPaginator({ containerId, paginationId, pageSize = 10, renderPage }) {
  let _currentPage = 1;
  let _items = [];

  function _totalPages() {
    return Math.max(1, Math.ceil(_items.length / pageSize));
  }

  function _render() {
    const total = _totalPages();
    _currentPage = Math.min(_currentPage, total);
    const start = (_currentPage - 1) * pageSize;
    const slice = _items.slice(start, start + pageSize);
    renderPage(slice, start);
    _renderControls(total);
  }

  function _renderControls(total) {
    const nav = document.getElementById(paginationId);
    if (!nav) return;

    if (total <= 1) {
      nav.innerHTML = '';
      return;
    }

    const cur = _currentPage;
    let html = '<ul class="pagination pagination-sm mb-0 flex-wrap">';

    // Prev
    html += `<li class="page-item${cur === 1 ? ' disabled' : ''}">
      <button class="page-link" data-page="${cur - 1}" ${cur === 1 ? 'tabindex="-1"' : ''}>&laquo;</button>
    </li>`;

    // Page numbers — show at most 5 around current
    const range = _pageRange(cur, total);
    if (range[0] > 1) {
      html += `<li class="page-item"><button class="page-link" data-page="1">1</button></li>`;
      if (range[0] > 2) html += `<li class="page-item disabled"><span class="page-link">&hellip;</span></li>`;
    }
    range.forEach(p => {
      html += `<li class="page-item${p === cur ? ' active' : ''}">
        <button class="page-link" data-page="${p}">${p}</button>
      </li>`;
    });
    if (range[range.length - 1] < total) {
      if (range[range.length - 1] < total - 1) html += `<li class="page-item disabled"><span class="page-link">&hellip;</span></li>`;
      html += `<li class="page-item"><button class="page-link" data-page="${total}">${total}</button></li>`;
    }

    // Next
    html += `<li class="page-item${cur === total ? ' disabled' : ''}">
      <button class="page-link" data-page="${cur + 1}" ${cur === total ? 'tabindex="-1"' : ''}>&raquo;</button>
    </li>`;

    html += '</ul>';
    nav.innerHTML = html;

    nav.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = parseInt(btn.dataset.page);
        if (p >= 1 && p <= total && p !== _currentPage) {
          _currentPage = p;
          _render();
          // Scroll the container into view
          document.getElementById(containerId)?.closest('.card')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    });
  }

  function _pageRange(cur, total, delta = 2) {
    const left  = Math.max(1, cur - delta);
    const right = Math.min(total, cur + delta);
    const range = [];
    for (let i = left; i <= right; i++) range.push(i);
    return range;
  }

  return {
    /** Call whenever the full data array changes (filter, store update, etc.) */
    update(items) {
      _items = items ?? [];
      _currentPage = 1;
      _render();
    },
    /** Re-render current page without resetting to page 1 (e.g. after edit) */
    refresh() {
      _render();
    },
  };
}
