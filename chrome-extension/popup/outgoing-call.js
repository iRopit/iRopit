// Language
const lang = localStorage.getItem('appLanguage') || 'en';
const isAr = lang === 'ar';
if (isAr) {
  document.documentElement.setAttribute('dir', 'rtl');
  document.documentElement.setAttribute('lang', 'ar');
}

// Parse URL params
const params = new URLSearchParams(location.search);
const contact = params.get('contact') || (isAr ? 'غير معروف' : 'Unknown');
const phone   = params.get('phone')   || '';
const device  = params.get('device')  || '';
const sim     = params.get('sim');

// Initials
const initials = contact
  .split(' ')
  .map(w => w[0] || '')
  .join('')
  .substring(0, 2)
  .toUpperCase() || (phone ? phone.slice(-2) : '?');

document.getElementById('avatar').textContent      = initials;
document.getElementById('contactName').textContent = contact;
document.getElementById('phoneNumber').textContent = phone;

// Meta badges (build safely via DOM — no innerHTML with untrusted strings)
const metaRow = document.getElementById('metaRow');

const SVG_NS = 'http://www.w3.org/2000/svg';

function makeBadge(iconPaths, text) {
  const badge = document.createElement('div');
  badge.className = 'meta-badge';

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '13');
  svg.setAttribute('height', '13');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');

  for (const p of iconPaths) {
    const el = document.createElementNS(SVG_NS, p.tag);
    for (const [k, v] of Object.entries(p.attrs)) el.setAttribute(k, v);
    svg.appendChild(el);
  }

  badge.appendChild(svg);
  badge.appendChild(document.createTextNode(' ' + text));
  return badge;
}

if (device) {
  metaRow.appendChild(makeBadge(
    [
      { tag: 'rect', attrs: { x: '5', y: '2', width: '14', height: '20', rx: '2', ry: '2' } },
      { tag: 'line', attrs: { x1: '12', y1: '18', x2: '12.01', y2: '18' } },
    ],
    device,
  ));
}

if (sim !== null && sim !== '-1' && sim !== '') {
  metaRow.appendChild(makeBadge(
    [
      { tag: 'rect', attrs: { x: '4', y: '2', width: '16', height: '20', rx: '2' } },
      { tag: 'path', attrs: { d: 'M8 6h4l4 4v8H8z' } },
    ],
    'SIM ' + (parseInt(sim, 10) + 1),
  ));
}

// Apply translations
if (isAr) {
  document.getElementById('callLabel').textContent = 'مكالمة صادرة';
  document.getElementById('dismissLabel').textContent = 'تجاهل';
  document.getElementById('dismissBtn').title = 'تجاهل';
}

// Dismiss closes window
document.getElementById('dismissBtn').addEventListener('click', () => window.close());

// Auto-close after 60 s (call would have been answered or ended by then)
setTimeout(() => window.close(), 60000);
