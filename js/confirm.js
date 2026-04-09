// js/confirm.js — Custom confirm dialog replacing native confirm()

/**
 * Shows a styled confirm dialog.
 * @param {string} message - The question to ask
 * @param {string} [title] - Optional title (default: "Are you sure?")
 * @param {string} [okLabel] - OK button label (default: "Delete")
 * @returns {Promise<boolean>}
 */
export function epConfirm(message, title = 'Are you sure?', okLabel = 'Delete') {
  return new Promise(resolve => {
    const modalEl = document.getElementById('ep-confirm-modal');
    if (!modalEl) { resolve(window.confirm(message)); return; }

    document.getElementById('ep-confirm-title').textContent = title;
    document.getElementById('ep-confirm-msg').textContent = message;
    document.getElementById('ep-confirm-ok').textContent = okLabel;

    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

    const okBtn = document.getElementById('ep-confirm-ok');
    const cancelBtn = document.getElementById('ep-confirm-cancel');

    function cleanup() {
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      modalEl.removeEventListener('hidden.bs.modal', onCancel);
    }

    function onOk() { cleanup(); modal.hide(); resolve(true); }
    function onCancel() { cleanup(); modal.hide(); resolve(false); }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    modalEl.addEventListener('hidden.bs.modal', onCancel, { once: true });

    modal.show();
  });
}
