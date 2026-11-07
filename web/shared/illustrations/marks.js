// Line drawings for empty states. Ink, one stroke weight, used at 40% opacity
// by `.empty .mark`. currentColor so the page colour does the rest.

const svg = (body) =>
  `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const marks = {
  plan: svg(`<rect x="8" y="10" width="32" height="26" rx="1.5"/><path d="M8 22h14v14M22 22V10M22 30h18"/>`),
  clock: svg(`<circle cx="24" cy="25" r="12"/><path d="M24 19v7l5 3M18 8h12"/>`),
  certificate: svg(`<rect x="10" y="8" width="28" height="32" rx="1.5"/><path d="M16 16h16M16 22h16M16 28h10"/><circle cx="32" cy="32" r="4"/>`),
  ticks: svg(`<path d="M10 16h6M10 24h6M10 32h6M20 16h18M20 24h18M20 32h18"/><path d="M11 15.5l1.6 1.6 3-3.2M11 23.5l1.6 1.6 3-3.2M11 31.5l1.6 1.6 3-3.2"/>`),
  search: svg(`<circle cx="21" cy="21" r="9"/><path d="M28 28l8 8"/>`),
  pencil: svg(`<path d="M10 34l4 4 20-20-4-4-20 20z"/><path d="M28 12l4 4M12 36l-2 4 4-2"/>`),
};

/** The empty panel, with its drawing above the words that were already there. */
export function emptyBlock(kind, html) {
  const mark = marks[kind] || "";
  return `<div class="empty">${mark ? `<span class="mark">${mark}</span>` : ""}${html}</div>`;
}

/** Pencil on a started drawing that has nothing on it. */
export function pencilMark() {
  return `<span class="blank-mark">${marks.pencil}</span>`;
}
