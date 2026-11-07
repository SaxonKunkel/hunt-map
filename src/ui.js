// Shared UI bits: bottom sheet, toasts, HTML escaping.
const $ = (s) => document.querySelector(s);

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const sheets = () => document.querySelectorAll('.sheet');
let onCloseCb = null;

// Show the main bottom sheet with the given HTML (or element). Returns the sheet body element.
export function openSheet(content, { onClose } = {}) {
  closeSheets();
  const body = $('#sheet-body');
  if (typeof content === 'string') body.innerHTML = content;
  else body.replaceChildren(content);
  $('#sheet').classList.remove('hidden');
  $('#sheet').scrollTop = 0;
  onCloseCb = onClose || null;
  return body;
}

export function openPanel(el) {
  closeSheets();
  el.classList.remove('hidden');
}

export function closeSheets() {
  sheets().forEach((s) => s.classList.add('hidden'));
  const cb = onCloseCb;
  onCloseCb = null;
  cb?.();
}

export const isOpen = (el) => !el.classList.contains('hidden');

let toastTimer;
export function toast(html, { ms = 2500, actions = [] } = {}) {
  const t = $('#toast');
  t.innerHTML = `<span>${html}</span>`;
  for (const a of actions) {
    const b = document.createElement('button');
    b.textContent = a.label;
    if (a.secondary) b.className = 'secondary';
    b.onclick = () => {
      t.classList.add('hidden');
      a.run();
    };
    t.appendChild(b);
  }
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

document.addEventListener('click', (e) => {
  if (e.target.closest('.sheet-close')) closeSheets();
});
