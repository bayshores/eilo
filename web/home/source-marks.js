/** Local source marks; rendering a source never makes a favicon request. */
const marks = {
  browser:
    '<circle cx="16" cy="16" r="14" fill="#e8bb63"/><path d="M16 2a14 14 0 0 1 12.12 7H16l-6.06 10.5L3.88 9A14 14 0 0 1 16 2" fill="#df8273"/><path d="M3.88 9 16 30A14 14 0 0 1 3.88 9M16 30l6.06-10.5H9.94" fill="#88b896"/><circle cx="16" cy="16" r="6.5" fill="#282b30"/><circle cx="16" cy="16" r="5" fill="#92bce0"/>',
  gmail:
    '<path d="M4 25V8l12 9L28 8v17" fill="none" stroke="#89b6a2" stroke-width="5" stroke-linejoin="round"/><path d="M4 25V8l12 9" fill="none" stroke="#90b3d5" stroke-width="5" stroke-linejoin="round"/><path d="m4 8 12 9 12-9" fill="none" stroke="#e59788" stroke-width="5" stroke-linejoin="round"/>',
  calendar:
    '<rect x="4" y="5" width="24" height="23" rx="5" fill="#dde4ec"/><path d="M9 5h14a5 5 0 0 1 5 5v2H4v-2a5 5 0 0 1 5-5" fill="#94b4d1"/><path d="M10 3v5m12-5v5" stroke="#dde4ec" stroke-width="3" stroke-linecap="round"/><path d="M10 17h3m6 0h3m-12 5h3m6 0h3" stroke="#556575" stroke-width="2" stroke-linecap="round"/>',
  desktop:
    '<rect x="3" y="5" width="26" height="18" rx="4" fill="#aec5cc"/><rect x="6" y="8" width="20" height="12" rx="2" fill="#2c3840"/><path d="M13 26h6m-3-3v3" stroke="#aec5cc" stroke-width="3" stroke-linecap="round"/>',
};

export function sourceMark(source) {
  const holder = document.createElement('span');
  holder.className = 'source-mark';
  holder.setAttribute('aria-hidden', 'true');
  if (Object.hasOwn(marks, source))
    holder.innerHTML = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">${marks[source]}</svg>`;
  else holder.textContent = String(source).slice(0, 1).toUpperCase();
  return holder;
}
