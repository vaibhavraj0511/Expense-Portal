// js/undo.js — Undo last action toast

let _undoTimer = null;

/**
 * Shows an undo toast at the bottom-right.
 * @param {string} message
 * @param {Function} undoFn
 */
export function showUndoToast(message, undoFn) {
  const toast = document.getElementById('undo-toast');
  const msgEl = document.getElementById('undo-toast-msg');
  const undoBtn = document.getElementById('undo-toast-btn');
  const closeBtn = document.getElementById('undo-toast-close');
  if (!toast || !msgEl) return;

  // Clear any existing timer
  if (_undoTimer) { clearTimeout(_undoTimer); _undoTimer = null; }

  msgEl.textContent = message;
  toast.classList.remove('d-none');
  toast.classList.add('undo-toast-visible');

  function hide() {
    toast.classList.remove('undo-toast-visible');
    toast.classList.add('d-none');
    if (_undoTimer) { clearTimeout(_undoTimer); _undoTimer = null; }
  }

  // Replace listeners to avoid stacking
  const newUndo = undoBtn.cloneNode(true);
  undoBtn.parentNode.replaceChild(newUndo, undoBtn);
  const newClose = closeBtn.cloneNode(true);
  closeBtn.parentNode.replaceChild(newClose, closeBtn);

  document.getElementById('undo-toast-btn').addEventListener('click', () => {
    undoFn();
    hide();
  });
  document.getElementById('undo-toast-close').addEventListener('click', hide);

  _undoTimer = setTimeout(hide, 5000);
}
