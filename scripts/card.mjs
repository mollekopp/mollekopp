// Renders the stats card as a self-contained SVG (GitHub serves README images
// through a proxy, so no web fonts, no scripts, no external CSS).

// Commit-type colors were run through a CVD validator in this order, as adjacent
// segments of the stacked bar. Reordering them needs a re-check.
const THEMES = {
  light: {
    surface: '#ffffff',
    surfaceRaised: '#f6f3f1',
    border: '#e6e0db',
    textPrimary: '#29221f',
    textSecondary: '#5c534e',
    textMuted: '#757575',
    baseline: '#d9d1cb',
    bar: '#1a7fb8',
    peak: '#eb6834',
    types: { feat: '#1a7fb8', fix: '#eb6834', chore: '#1baf7a', refactor: '#4a3aa7', freestyle: '#e87ba4' },
  },
  dark: {
    surface: '#151b23',
    surfaceRaised: '#1d242d',
    border: '#30363d',
    textPrimary: '#f5f1ee',
    textSecondary: '#c9c0ba',
    textMuted: '#a09690',
    baseline: '#3d444d',
    bar: '#3a95d0',
    peak: '#d95926',
    types: { feat: '#3a95d0', fix: '#d95926', chore: '#199e70', refactor: '#9085e9', freestyle: '#d55181' },
  },
};

const WIDTH = 820;
const TILE_HEIGHT = 72;
const TILE_GAP = 12;
// The second tile row pushes everything below it down by one row.
const ROW_OFFSET = TILE_HEIGHT + TILE_GAP;
const HEIGHT = 376 + ROW_OFFSET;
const PAD = 28;

const number = (n) => n.toLocaleString('en-US');
const percent = (share) => {
  const value = share * 100;
  return `${value > 0 && value < 10 ? value.toFixed(1) : Math.round(value)} %`;
};
const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Bar with 4px rounded data-end, square at the baseline.
function columnPath(x, baseline, width, height) {
  const r = Math.min(4, width / 2, height);
  const top = baseline - height;
  return `M${x},${baseline}V${top + r}Q${x},${top} ${x + r},${top}H${x + width - r}Q${x + width},${top} ${x + width},${top + r}V${baseline}Z`;
}

// One row of tiles across the full width. Two tiles span exactly two columns of
// a four-tile row, so stacked rows stay on the same grid.
function tiles(items, y, t) {
  const width = (WIDTH - 2 * PAD - TILE_GAP * (items.length - 1)) / items.length;
  return items
    .map(([value, label], i) => {
      const x = PAD + i * (width + TILE_GAP);
      return `
    <rect x="${x}" y="${y}" width="${width}" height="${TILE_HEIGHT}" rx="8" fill="${t.surfaceRaised}"/>
    <text x="${x + 16}" y="${y + 36}" class="value" fill="${t.textPrimary}">${escape(value)}</text>
    <text x="${x + 16}" y="${y + 58}" class="label" fill="${t.textSecondary}">${escape(label)}</text>`;
    })
    .join('');
}

function typeBreakdown(data, t) {
  const x0 = PAD;
  const width = 360;
  const total = data.types.reduce((sum, type) => sum + type.count, 0) || 1;
  const gap = 2;
  const visible = data.types.filter((type) => type.count > 0);
  const usable = width - gap * (visible.length - 1);

  let x = x0;
  const segments = visible
    .map((type, i) => {
      const w = (type.count / total) * usable;
      const first = i === 0;
      const last = i === visible.length - 1;
      const r = 4;
      // Only the outer ends of the stack get rounded corners.
      const d = `M${x + (first ? r : 0)},198H${x + w - (last ? r : 0)}${last ? `Q${x + w},198 ${x + w},${198 + r}V${212 - r}Q${x + w},212 ${x + w - r},212` : `V212`}H${x + (first ? r : 0)}${first ? `Q${x},212 ${x},${212 - r}V${198 + r}Q${x},198 ${x + r},198` : `V198`}Z`;
      x += w + gap;
      return `<path d="${d}" fill="${t.types[type.key]}"><title>${escape(type.label)}: ${number(type.count)} (${percent(type.count / total)})</title></path>`;
    })
    .join('');

  const legend = data.types
    .map((type, i) => {
      const col = i < 3 ? 0 : 1;
      const row = i < 3 ? i : i - 3;
      const lx = x0 + col * 186;
      const ly = 240 + row * 24;
      return `
    <rect x="${lx}" y="${ly - 9}" width="10" height="10" rx="2" fill="${t.types[type.key]}"/>
    <text x="${lx + 18}" y="${ly}" class="small" fill="${t.textSecondary}"><tspan fill="${t.textPrimary}" font-weight="600">${percent(type.count / total)}</tspan>  ${escape(type.label)}</text>`;
    })
    .join('');

  return `
    <text x="${x0}" y="184" class="heading" fill="${t.textPrimary}">What I commit</text>
    ${segments}${legend}`;
}

function hourHistogram(data, t) {
  const x0 = 432;
  const width = WIDTH - PAD - x0;
  const baseline = 290;
  const maxHeight = 82;
  const max = Math.max(...data.hours, 1);
  const slot = width / 24;
  const barWidth = slot - 3;

  const bars = data.hours
    .map((count, hour) => {
      if (!count) return '';
      const h = Math.max((count / max) * maxHeight, 2);
      const fill = hour === data.peakHour ? t.peak : t.bar;
      return `<path d="${columnPath(x0 + hour * slot, baseline, barWidth, h)}" fill="${fill}"><title>${String(hour).padStart(2, '0')}:00 – ${number(count)} commits</title></path>`;
    })
    .join('');

  const ticks = [0, 6, 12, 18]
    .map((hour) => `<text x="${x0 + hour * slot + barWidth / 2}" y="${baseline + 18}" class="small" text-anchor="middle" fill="${t.textMuted}">${String(hour).padStart(2, '0')}:00</text>`)
    .join('');

  const peakX = x0 + data.peakHour * slot + barWidth / 2;
  const peakLabel = `<text x="${peakX}" y="${baseline - maxHeight - 8}" class="small" text-anchor="middle" fill="${t.textPrimary}" font-weight="600">peak ${String(data.peakHour).padStart(2, '0')}:00</text>`;

  return `
    <text x="${x0}" y="184" class="heading" fill="${t.textPrimary}">When I commit <tspan class="small" font-weight="400" fill="${t.textMuted}">(Berlin time)</tspan></text>
    <line x1="${x0}" x2="${x0 + width}" y1="${baseline + 0.5}" y2="${baseline + 0.5}" stroke="${t.baseline}"/>
    ${bars}${peakLabel}${ticks}
    <text x="${x0}" y="${baseline + 46}" class="small" fill="${t.textSecondary}">Night owl ${percent(data.nightOwl)} · weekend ${percent(data.weekend)} · busiest day ${escape(data.busiestWeekday)}</text>`;
}

export function renderCard(data, mode) {
  const t = THEMES[mode];
  const summary = `${number(data.commits)} commits by hand in ${number(data.repos)} repos over the last 12 months, ${data.activeDays} active days, longest streak ${data.longestStreak} days, ${number(data.prsMerged)} pull requests merged (${percent(data.mergeRate)} of those opened), peak hour ${data.peakHour}:00.`;
  const commitTiles = [
    [number(data.commits), 'commits by hand'],
    [number(data.activeDays), 'active days'],
    [`${data.longestStreak} days`, 'longest streak'],
    [number(data.repos), 'repos touched'],
  ];
  const prTiles = [
    [number(data.prsMerged), 'pull requests merged'],
    [percent(data.mergeRate), `of ${number(data.prsOpened)} opened PRs merged`],
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="title desc">
  <title id="title">Axel's commit stats</title>
  <desc id="desc">${escape(summary)}</desc>
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
    .title { font-size: 20px; font-weight: 700; }
    .subtitle { font-size: 13px; }
    .value { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .label { font-size: 13px; }
    .heading { font-size: 14px; font-weight: 600; }
    .small { font-size: 12px; font-variant-numeric: tabular-nums; }
  </style>
  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="12" fill="${t.surface}" stroke="${t.border}"/>
  <text x="${PAD}" y="44" class="title" fill="${t.textPrimary}">Behind the private repos</text>
  <text x="${PAD}" y="66" class="subtitle" fill="${t.textSecondary}">Last 12 months, numbers only. No code leaves the building.</text>
  <text x="${WIDTH - PAD}" y="44" class="small" text-anchor="end" fill="${t.textMuted}">updated ${escape(data.updated)}</text>
  ${tiles(commitTiles, 88, t)}
  ${tiles(prTiles, 88 + ROW_OFFSET, t)}
  <g transform="translate(0 ${ROW_OFFSET})">
  ${typeBreakdown(data, t)}
  ${hourHistogram(data, t)}
  </g>
  <text x="${PAD}" y="${HEIGHT - 20}" class="small" fill="${t.textMuted}">Deploy-bot commits are not counted.</text>
</svg>
`;
}
