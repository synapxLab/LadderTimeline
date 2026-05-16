import './components/ladder-timeline/LadderTimeline.scss';
import { LadderTimeline } from './components/ladder-timeline/LadderTimeline';
import { bindTimelineToCalendar, type FullCalendarInstance } from './adapters/FullCalendarAdapter';
import type { TimelineItemInfo } from './components/ladder-timeline/LadderTimeline.types';
import type { ScaleId } from './components/ladder-timeline/Scale';

declare global {
  interface Window { timelineA?: LadderTimeline; }
}

const mockCalendar: FullCalendarInstance = {
  gotoDate(date: Date): void {
    console.log('[FullCalendar] gotoDate →', date.toLocaleDateString('fr-FR'));
  },
  getDate(): Date { return new Date(); },
};

// ─── Item display (toutes échelles) ───────────────────────────────────────────

const weekDisplayEl = document.getElementById('week-display');
function updateDisplay(info: TimelineItemInfo): void {
  if (!weekDisplayEl) return;
  const main = info.label || '—';
  const sub  = info.sublabel ? ` · ${info.sublabel}` : '';
  weekDisplayEl.textContent = `${main}${sub}`;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('timeline-a');
  if (!container) return;

  const timeline = new LadderTimeline({
    container,
    firstDayOfWeek: 1,
    theme: 'auto',
    storageKey: 'lt-demo',
    // ── Démo : bornes ─────────────────────────────────────────────────────────
    minScale: 'us',
    maxScale: 'millennium',
    minDate: new Date(1900, 0, 1),
    maxDate: new Date(2100, 11, 31),
    displayMode: 'expanded',
    // ── Démo : markers ────────────────────────────────────────────────────────
    markers: [
      { id: 'covid',    year: 2020.214, label: 'Confinement COVID',   color: '#16a34a' },
      { id: 'mun',      year: 1969.553, label: 'Apollo 11',           color: '#0ea5e9' },
      { id: 'ww2',      year: 1945.342, label: 'Fin WW2',             color: '#dc2626' },
      { id: 'inet',     year: 1989.221, label: 'Naissance du Web',    color: '#7c3aed' },
      { id: 'fall',     year: 1989.847, label: 'Chute mur de Berlin', color: '#ea580c' },
    ],
    onMarkerClick: m => console.log('[marker]', m),
    onItemChange:  updateDisplay,
    onItemPreview: updateDisplay,
  });

  bindTimelineToCalendar(timeline, mockCalendar);
  window.timelineA = timeline;

  document.getElementById('today-btn')?.addEventListener('click', () => {
    window.timelineA?.goToToday();
  });

  // ─── Scale picker — pilote la timeline ──────────────────────────────────────
  // L'ordre est : du plus large (haut de liste) au plus fin (bas de liste).
  // ▲ haut = zoom in = échelle plus fine = avance dans la liste (index +1).
  const SCALES: ReadonlyArray<{ id: ScaleId; label: string }> = [
    { id: 'Ga',         label: "Milliard d'années" },
    { id: '100Ma',      label: 'Centaine de millions d\'années' },
    { id: 'Ma',         label: "Million d'années" },
    { id: '100ka',      label: 'Centaine de milliers d\'années' },
    { id: '10ka',       label: '10 000 ans' },
    { id: 'millennium', label: 'Millénaire' },
    { id: 'century',    label: 'Siècle' },
    { id: 'decade',     label: 'Décennie' },
    { id: 'year',       label: 'Année' },
    { id: 'month',      label: 'Mois' },
    { id: 'week',       label: 'Semaine' },
    { id: 'day',        label: 'Jour' },
    { id: 'hour',       label: 'Heure' },
    { id: 'minute',     label: 'Minute' },
    { id: 'second',     label: 'Seconde' },
    { id: 'ms',         label: 'Milliseconde' },
    { id: 'us',         label: 'Microseconde' },
    { id: 'ns',         label: 'Nanoseconde' },
  ];

  const scaleLabelEl = document.getElementById('scale-label');
  const scaleUpBtn   = document.getElementById('scale-up-btn')   as HTMLButtonElement | null;
  const scaleDownBtn = document.getElementById('scale-down-btn') as HTMLButtonElement | null;

  // Bornes effectives (potentiellement clampées par le composant)
  const bounds = timeline.getBounds();
  const minIdx = SCALES.findIndex(s => s.id === bounds.maxScale); // coarsest = lowest idx
  const maxIdx = SCALES.findIndex(s => s.id === bounds.minScale); // finest   = highest idx

  let scaleIndex = SCALES.findIndex(s => s.id === timeline.getScale());
  if (scaleIndex < 0) scaleIndex = SCALES.findIndex(s => s.id === 'week');

  function renderScale(): void {
    const current = SCALES[scaleIndex];
    if (scaleLabelEl && current) scaleLabelEl.textContent = current.label;
    if (scaleUpBtn)   scaleUpBtn.disabled   = scaleIndex >= maxIdx;
    if (scaleDownBtn) scaleDownBtn.disabled = scaleIndex <= minIdx;
    if (current) timeline.setScale(current.id);
  }
  function scaleUp():   void { if (scaleIndex < maxIdx) { scaleIndex++; renderScale(); } }
  function scaleDown(): void { if (scaleIndex > minIdx) { scaleIndex--; renderScale(); } }

  renderScale();

  scaleUpBtn?.addEventListener('click',   scaleUp);
  scaleDownBtn?.addEventListener('click', scaleDown);

  // ─── Display mode toggle (expanded ↔ compact) ──────────────────────────────
  const displayModeToggle = document.getElementById('display-mode-toggle') as HTMLInputElement | null;
  if (displayModeToggle) {
    displayModeToggle.checked = timeline.getDisplayMode() === 'compact';
    displayModeToggle.addEventListener('change', () => {
      timeline.setDisplayMode(displayModeToggle.checked ? 'compact' : 'expanded');
    });
  }

  // ─── Clavier global : ←/→ déjà gérés par le composant (focus listWrapper). ─
  // ↑/↓ pilotent l'échelle. '+' / '-' en bonus.
  // Ignore quand l'utilisateur tape dans un input/textarea/contenteditable.
  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

    switch (e.key) {
      case 'ArrowUp':
      case '+':       e.preventDefault(); scaleUp();   break;
      case 'ArrowDown':
      case '-':       e.preventDefault(); scaleDown(); break;
      case 'ArrowLeft':  e.preventDefault(); window.timelineA?.goToPrevious(); break;
      case 'ArrowRight': e.preventDefault(); window.timelineA?.goToNext();     break;
      case 'Home':       e.preventDefault(); window.timelineA?.goToToday();    break;
    }
  });

  // Debug panel — dev only, exclu automatiquement du bundle de production
  if (import.meta.env.DEV) {
    import('./debug').then(({ initDebugger }) => initDebugger(timeline));
  }
});
