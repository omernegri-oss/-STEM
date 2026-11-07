// Line icons for the interface (24x24, drawn with the current text colour) and emoji clean-up.
import { FURNITURE, PRODUCT_MAP } from '/shared/data.js';
import { productThumb } from './products3d.js';

const P = {
  box: 'M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5l9 4.5 9-4.5M12 12v9',
  layout: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  award: 'M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8.5 14 7 22l5-3 5 3-1.5-8',
  pause: 'M8 5v14M16 5v14',
  speaker: 'M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  mute: 'M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6',
  music: 'M9 18V6l11-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  gauge: 'M12 21a9 9 0 1 1 9-9M12 12l5-4M3.5 15h3M12 3v3',
  eco: 'M12 21a9 9 0 1 1 9-9M12 12l-3-5M3.5 15h3M12 3v3',
  userplus: 'M15 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-3A4.5 4.5 0 0 0 3 18.5V20M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M16 11h6',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7v.5M12 17h.01',
  exit: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h11',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  truck: 'M2 6h11v10H2zM13 9h4l4 4v3h-8M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  key: 'M14.5 9.5a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0zM13.5 12.5 21 20M17 16l2-2M19 18l2-2',
  tag: 'M3 3h8l10 10-8 8L3 11zM7.5 7.5h.01',
  users: 'M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM22 20v-1.5a4 4 0 0 0-3-3.9M16 4.2a3.5 3.5 0 0 1 0 6.6',
  wrench: 'M14.7 6.3a4 4 0 0 0 5 5L21 13l-8 8-3-3 6.5-6.5a4 4 0 0 1-5-5L13 5zM3 21l6-6',
  receipt: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6M9 16h4',
  coin: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM14.5 9.5c-.4-.9-1.4-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.1 0-2.1-.6-2.5-1.5M12 6.5v11',
  alert: 'M12 3 2 20h20zM12 10v4M12 17h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01',
  thermo: 'M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z',
  check: 'M4 12.5 9 17.5 20 6.5',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  shelf: 'M4 3v18M20 3v18M4 7h16M4 12h16M4 17h16',
  fridge: 'M6 2h12v20H6zM6 10h12M9 5v2M9 13v3',
  snow: 'M12 2v20M4 6.5l16 11M4 17.5l16-11M9 3.5l3 2.5 3-2.5M9 20.5l3-2.5 3 2.5',
  leaf: 'M5 20c0-9 5-15 15-16-1 10-7 15-15 16zM5 20l8-8',
  knife: 'M3 21 15 9l2 2-9 9zM15 9l4.5-5.5a1.5 1.5 0 0 1 2 2L17 11',
  register: 'M4 12h16v8H4zM6 12V8h12v4M8 4h8v4H8zM8 16h2M12 16h2M16 16h.01',
  pallet: 'M3 18h18M5 18v3M12 18v3M19 18v3M4 6h7v6H4zM13 4h7v8h-7zM4 12h16',
  plant: 'M12 22v-8M12 14c-4 0-6-3-6-7 4 0 6 3 6 7zM12 12c0-4 2-7 6-7 0 4-2 7-6 7zM8 22h8',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
  lamp: 'M9 2h6l3 8H6zM12 10v10M8 22h8',
  monitor: 'M3 4h18v12H3zM8 21h8M12 16v5',
  cup: 'M5 8h12v6a6 6 0 0 1-12 0zM17 10h2a2 2 0 0 1 0 4h-2M8 2v3M12 2v3',
  seat: 'M6 3v10h12V3M4 13h16v3H4zM6 16v5M18 16v5',
  broom: 'M14 3 8 13M6 13h6l3 8H3zM7 17v4M10 17v4',
  cheese: 'M3 18 21 8v10zM3 18 15 6l6 2M9 14h.01M15 15h.01M17 11h.01',
  cart: 'M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6M10 21h.01M17 21h.01',
  chevron: 'M9 6l6 6-6 6',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  calendar: 'M4 5h16v16H4zM4 10h16M9 3v4M15 3v4',
  expand: 'M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6',
  download: 'M12 3v12M7 10l5 5 5-5M4 20h16',
  close: 'M6 6l12 12M18 6 6 18',
};
export function svg(name, size = 18) {
  const d = P[name] || P.info;
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}
export function setIcon(el, name, size) { if (el) el.innerHTML = svg(name, size); }

// what to show for game things in lists
export function furnitureIcon(type) {
  const def = FURNITURE[type] || {};
  const byType = { computer: 'monitor', plant: 'plant', plant_tall: 'plant', flowerpot: 'plant', cactus: 'plant', flowers: 'plant', bin: 'trash', lamp: 'lamp', sign: 'tag', balloons: 'tag',
    bench: 'seat', fountain: 'seat', vending: 'cup', statue: 'cup', neon: 'monitor', butcher: 'knife', deli: 'cheese', rack: 'pallet', checkout: 'register', selfcheckout: 'register' };
  if (byType[type]) return byType[type];
  if (def.kind === 'storage') return def.cat === 'produce' ? 'leaf' : def.cat === 'frozen' ? 'snow' : def.cat === 'fridge' ? 'fridge' : 'shelf';
  return { checkout: 'register', rack: 'pallet', dept: 'knife', decor: 'plant' }[def.kind] || 'box';
}
export const ROLE_ICON = { cashier: 'register', stocker: 'box', cleaner: 'broom', butcher: 'knife', deli: 'cheese', manager: 'users' };
// server messages carry an emoji "kind"; show a matching line icon instead
const MSG_ICON = { '📦': 'box', '🚚': 'truck', '⚠️': 'alert', '🔥': 'alert', '💸': 'coin', '💰': 'coin', '💵': 'coin', '🧾': 'receipt', '🔧': 'wrench', '🌡️': 'thermo', '📈': 'chart', '⭐': 'star', '🏆': 'award', '💬': 'mail', 'ℹ️': 'info', '🔑': 'key', '🏷️': 'tag', '👥': 'users', '📉': 'chart', '😡': 'alert', '🤩': 'star', '🎉': 'star', '💢': 'alert', '📣': 'info' };
export function msgIcon(e) { return MSG_ICON[e] || 'info'; }

const thumbs = new Map();
export function productImg(pid, size = 28) {
  const p = PRODUCT_MAP[pid]; if (!p) return '';
  if (!thumbs.has(pid)) thumbs.set(pid, productThumb(p));
  return `<img class="pthumb" src="${thumbs.get(pid)}" width="${size}" height="${size}" alt="" />`;
}

// emoji never go on screen: strip them (and joiners/variation selectors) from any text we show
const EMOJI = /(\s?)((?:[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}\u{2139}](?:\u{FE0F})?(?:\u{200D}[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}](?:\u{FE0F})?)*))(\s?)/gu;
const KEEP = new Set(['★', '☆', '✓', '✕', '✖', '⏻', '⛶']);
// drop the emoji and the gap it leaves (keep one space only when it sat between two words)
export function noEmoji(s) {
  return String(s ?? '').replace(EMOJI, (m, lead, e, trail) => KEEP.has(e.replace(/\u{FE0F}/gu, '')) ? m : (lead && trail ? ' ' : ''))
    .replace(/\u{FE0F}/gu, '').replace(/^\s+/, '');
}
