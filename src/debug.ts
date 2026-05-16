/**
 * Panneau de debug LadderTimeline — dev only.
 * Importé dynamiquement depuis main.ts uniquement quand import.meta.env.DEV === true.
 * Jamais inclus dans le bundle de production.
 */
import { LadderTimeline } from './components/ladder-timeline/LadderTimeline';

export function initDebugger(timeline: LadderTimeline): void {
  const eventTarget = timeline.getEventTarget();

  // ─── Log d'événements ────────────────────────────────────────────────────────

  const eventLog: string[] = [];

  function logEvent(msg: string): void {
    const t = new Date().toLocaleTimeString('fr-FR', { hour12: false });
    eventLog.unshift(`[${t}] ${msg}`);
    if (eventLog.length > 12) eventLog.pop();
  }

  eventTarget.addEventListener('weekchange', () => {
    const s = timeline.debugState() as Record<string, unknown>;
    logEvent(`✅ snap → ${s['selectedDate'] as string}`);
    if (s['nearEdgeLeft'] || s['nearEdgeRight']) {
      logEvent(`🔄 extension (idx ${s['centerIdx'] as number}/${s['totalItems'] as number})`);
    }
  });

  // ─── Panneau DOM ─────────────────────────────────────────────────────────────

  const panel = document.createElement('div');
  panel.style.cssText = `
    position:fixed; bottom:12px; right:12px; z-index:9999;
    background:#0d1117; color:#c9d1d9; font:11px/1.6 'JetBrains Mono',monospace;
    border:1px solid #30363d; border-radius:8px; padding:12px 14px;
    width:310px; max-height:90vh; overflow-y:auto;
    box-shadow:0 8px 32px rgba(0,0,0,.6);
  `;
  document.body.appendChild(panel);

  const color = (warn: boolean, crit = false) =>
    crit ? '#ff7b72' : warn ? '#ffa657' : '#7ee787';

  // ─── Tick 60 fps ─────────────────────────────────────────────────────────────

  function tick(): void {
    const s = timeline.debugState() as Record<string, unknown>;

    const row = (label: string, val: unknown, warn = false, crit = false) =>
      `<div><span style="color:#8b949e;min-width:130px;display:inline-block">${label}</span>` +
      `<span style="color:${color(warn, crit)}">${String(val)}</span></div>`;

    // Mini-map
    const total  = s['totalItems'] as number;
    const cIdx   = s['centerIdx']  as number;
    const sIdx   = s['selIdx']     as number;
    const thresh = s['EXTEND_THRESHOLD'] as number;
    const map = Array.from({ length: total }, (_, i) => {
      if (i === cIdx && i === sIdx) return '<span style="color:#ffa657">◉</span>';
      if (i === cIdx)               return '<span style="color:#58a6ff">○</span>';
      if (i === sIdx)               return '<span style="color:#7ee787">●</span>';
      if (i < thresh || i > total - 1 - thresh) return '<span style="color:#ff7b72">·</span>';
      return '<span style="color:#30363d">·</span>';
    }).join('');

    // Scroll bar
    const maxScroll = s['maxScrollLeft'] as number;
    const scroll    = s['scrollLeft']    as number;
    const barW = 28;
    const pos  = maxScroll > 0 ? Math.round((scroll / maxScroll) * barW) : 0;
    const scrollBar =
      '▕' +
      '░'.repeat(Math.max(0, pos)) +
      '<span style="color:#ffa657">█</span>' +
      '░'.repeat(Math.max(0, barW - pos)) +
      '▏';

    const atLimit = (s['distToRight'] as number) <= 2;

    panel.innerHTML = [
      `<div style="color:#58a6ff;font-weight:700;font-size:12px;margin-bottom:8px">◈ LadderTimeline Debug</div>`,

      `<div style="color:#8b949e;font-size:10px;margin-bottom:2px">── ÉTAT ──────────────────────────</div>`,
      row('selectedDate',  s['selectedDate']),
      row('referenceDate', s['referenceDate']),
      row('isDragging',    s['isDragging'],  false, s['isDragging'] === true),
      row('rafActif',      s['rafActive'],   s['rafActive'] === true),
      row('velX (px/ms)',  s['velX']),

      `<div style="color:#8b949e;font-size:10px;margin:6px 0 2px">── SCROLL ────────────────────────</div>`,
      row('scrollLeft',    s['scrollLeft']),
      row('maxScrollLeft', s['maxScrollLeft']),
      row('distToRight',   s['distToRight'], (s['distToRight'] as number) < 200, atLimit),
      row('scrollWidth',   s['scrollWidth']),
      row('clientWidth',   s['clientWidth']),
      row('paddingLeft',   s['paddingLeft']),
      row('paddingRight',  s['paddingRight']),
      row('itemWidth',     s['itemWidth']),
      `<div style="margin:4px 0;font-size:10px">${scrollBar}</div>`,

      `<div style="color:#8b949e;font-size:10px;margin:6px 0 2px">── ITEMS ─────────────────────────</div>`,
      row('totalItems',    s['totalItems'],   false, (s['totalItems'] as number) < 20),
      row('weeksToLeft',   s['weeksToLeft'],  (s['weeksToLeft'] as number) < 10),
      row('weeksToRight',  s['weeksToRight'], false, (s['weeksToRight'] as number) <= 0),
      row('firstWeek',     s['firstWeek']),
      row('lastWeek',      s['lastWeek']),

      `<div style="color:#8b949e;font-size:10px;margin:6px 0 2px">── CENTRE & SÉLECTION ────────────</div>`,
      row('centerIdx',       `${s['centerIdx']} → ${s['centerWeek']}`),
      row('selIdx',          `${s['selIdx']} → ${s['selWeek']}`, false, s['selIdx'] === -1),
      row('center = sel',    s['centerMatchSel'], false, s['centerMatchSel'] === false),

      `<div style="color:#8b949e;font-size:10px;margin:6px 0 2px">── EXTENSION ─────────────────────</div>`,
      row('nearEdgeLeft',    s['nearEdgeLeft'],   false, s['nearEdgeLeft']  === true),
      row('nearEdgeRight',   s['nearEdgeRight'],  false, s['nearEdgeRight'] === true),
      row('EXTEND_THRESHOLD', s['EXTEND_THRESHOLD']),
      row('extendWillFire',  s['extendWillFire'], s['extendWillFire'] === true),

      `<div style="color:#8b949e;font-size:10px;margin:6px 0 2px">── MINI-MAP (rouge = zone bord) ──</div>`,
      `<div style="letter-spacing:1px;font-size:10px;word-break:break-all">${map}</div>`,
      `<div style="font-size:9px;color:#8b949e;margin-top:2px">● sel  ○ centre  ◉ les deux  · bord</div>`,

      `<div style="color:#8b949e;font-size:10px;margin:6px 0 2px">── LOG ÉVÉNEMENTS ────────────────</div>`,
      eventLog.map(e => `<div style="color:#8b949e;font-size:10px">${e}</div>`).join('')
        || '<div style="color:#30363d">—</div>',
    ].join('');

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}
