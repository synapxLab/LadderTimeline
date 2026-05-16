/**
 * LadderTimeline — Carousel multi-échelles
 *
 * Cursor interne unifié = decimal year (float64). L'échelle active fournit
 * via Scale.build() les items à afficher. Le drag/momentum/scroll/visuals
 * ne dépendent pas de l'échelle.
 */

import type {
  LadderTimelineOptions,
  LadderTimelineSelectEventDetail,
  CalendarAdapter,
  TimelineItemInfo,
} from './LadderTimeline.types';

import {
  normalizeDate,
  cloneDate,
  getWeekStart,
  getWeekEnd,
  isValidDate,
} from './LadderTimeline.utils';

import {
  createWeekChangeEvent,
  createSelectEvent,
  createNavigateEvent,
  EVENT_WEEK_CHANGE,
  EVENT_SELECT,
  EVENT_NAVIGATE,
} from './LadderTimeline.events';

import {
  type Scale,
  type ScaleId,
  getScale,
  scaleIndex,
  scaleAt,
  SCALE_COUNT,
  dateToYear,
  yearToDate,
  todayYear,
  inDateRange,
} from './Scale';

// ─── Constantes ────────────────────────────────────────────────────────────────

const CAROUSEL_WEEKS    = 51;
const EXTEND_THRESHOLD  = 8;
const MOMENTUM_FRICTION = 0.90;
const MOMENTUM_MIN_VEL  = 0.08;
const SCALE_MIN         = 0.82;
const OPACITY_MIN       = 0.40;
/** Délai (ms) entre deux navigations molette */
const WHEEL_DEBOUNCE_MS = 250;

const DEFAULTS = {
  firstDayOfWeek: 1 as const,
  // Suit la langue du navigateur ; fallback 'fr-FR' en SSR / environnement sans navigator
  locale: typeof navigator !== 'undefined' ? navigator.language : 'fr-FR',
  compact: false,
  scale: 'week' as ScaleId,
};

// ─── LadderTimeline ─────────────────────────────────────────────────────────────

export class LadderTimeline {
  // Config
  private readonly container: HTMLElement;
  private readonly firstDayOfWeek: 0 | 1;
  private readonly locale: string;
  private readonly compact: boolean;
  private readonly theme: 'light' | 'dark' | 'auto';
  private readonly storageKey: string | undefined;
  private readonly onWeekChangeCb:  ((d: LadderTimelineSelectEventDetail) => void) | undefined;
  private readonly onWeekPreviewCb: ((d: LadderTimelineSelectEventDetail) => void) | undefined;
  private readonly onItemChangeCb:  ((i: TimelineItemInfo) => void) | undefined;
  private readonly onItemPreviewCb: ((i: TimelineItemInfo) => void) | undefined;

  // Dark mode auto
  private _darkMq: MediaQueryList | undefined;
  private _darkMqHandler: ((e: MediaQueryListEvent) => void) | undefined;

  // State — cursor en decimal year
  private selectedYear: number;
  private referenceYear: number;
  private scale: Scale;

  // Bornes (immutable après construction)
  private readonly minYear: number;
  private readonly maxYear: number;
  private readonly coarsestScaleIdx: number;  // index dans SCALES — petit = grossier (Ga=0)
  private readonly finestScaleIdx:   number;  // index dans SCALES — grand = fin (ns=17)

  // DOM
  private root!: HTMLElement;
  private listWrapper!: HTMLElement;
  private listEl!: HTMLElement;
  private centerMark!: HTMLElement;

  // Drag
  private isDragging      = false;
  private dragStartX      = 0;
  private dragStartScroll = 0;

  // Momentum
  private velX      = 0;
  private lastMoveX = 0;
  private lastMoveT = 0;

  // RAF
  private rafId: number | undefined;

  // Molette — #4
  private wheelDebounceId: number | undefined;

  // Extension proactive
  private _isExtending = false;

  // Spring snap
  private springRafId: number | undefined;

  // Misc
  private cleanupFns: Array<() => void> = [];
  private resizeObserver?: ResizeObserver;
  private calendarAdapter?: CalendarAdapter;

  // ─── Constructor ────────────────────────────────────────────────────────────

  constructor(options: LadderTimelineOptions) {
    if (!options.container) throw new Error('[LadderTimeline] container is required');

    this.container      = options.container;
    this.firstDayOfWeek = options.firstDayOfWeek ?? DEFAULTS.firstDayOfWeek;
    this.locale         = options.locale          ?? DEFAULTS.locale;
    this.compact        = options.compact         ?? DEFAULTS.compact;
    this.theme          = options.theme           ?? 'light';
    this.storageKey     = options.storageKey;
    this.onWeekChangeCb  = options.onWeekChange;
    this.onWeekPreviewCb = options.onWeekPreview;
    this.onItemChangeCb  = options.onItemChange;
    this.onItemPreviewCb = options.onItemPreview;

    // ── Bornes year ──────────────────────────────────────────────────────────
    this.minYear =
      typeof options.minYear === 'number'           ? options.minYear
    : isValidDate(options.minDate)                  ? dateToYear(options.minDate)
    : -Infinity;
    this.maxYear =
      typeof options.maxYear === 'number'           ? options.maxYear
    : isValidDate(options.maxDate)                  ? dateToYear(options.maxDate)
    : Infinity;

    // ── Bornes échelle ───────────────────────────────────────────────────────
    // coarsestScaleIdx = plus grossier autorisé (= plus petit index → maxScale)
    // finestScaleIdx   = plus fin autorisé (= plus grand index → minScale)
    this.coarsestScaleIdx = options.maxScale ? scaleIndex(options.maxScale) : 0;
    this.finestScaleIdx   = options.minScale ? scaleIndex(options.minScale) : SCALE_COUNT - 1;

    // ── Échelle initiale (clampée) ──────────────────────────────────────────
    const requestedScale = options.scale ?? DEFAULTS.scale;
    this.scale = getScale(this._clampScaleId(requestedScale));

    const today = todayYear();
    this.selectedYear  = isValidDate(options.selectedDate)  ? dateToYear(normalizeDate(options.selectedDate))  : today;
    this.referenceYear = isValidDate(options.referenceDate) ? dateToYear(normalizeDate(options.referenceDate)) : this.selectedYear;

    // Persistence : la date stockée prend priorité si aucune selectedDate explicite
    if (this.storageKey && !isValidDate(options.selectedDate)) {
      const stored = this._readStorage();
      if (stored !== null) { this.selectedYear = stored; this.referenceYear = stored; }
    }

    this.selectedYear  = this._clampYear(this.scale.snap(this.selectedYear));
    this.referenceYear = this._clampYear(this.scale.snap(this.referenceYear));

    // Si l'échelle initiale est calendaire et le year chargé est hors plage Date
    // (storage rempli depuis une échelle macro), retour aujourd'hui.
    if (this.scale.step < 1 && !inDateRange(this.selectedYear)) {
      const t = this._clampYear(this.scale.snap(todayYear()));
      this.selectedYear  = t;
      this.referenceYear = t;
    }

    this.render();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  setDate(date: Date): void {
    if (!isValidDate(date)) return;
    const y = dateToYear(normalizeDate(date));
    this.selectedYear  = this._clampYear(this.scale.snap(y));
    this.referenceYear = this.selectedYear;
    this._updateListDOM(false);
    this._emitItemChange(this.selectedYear);
  }

  getDate(): Date {
    return inDateRange(this.selectedYear) ? yearToDate(this.selectedYear) : new Date();
  }

  goToToday(): void {
    const y = this._clampYear(this.scale.snap(todayYear()));
    this.selectedYear  = y;
    this.referenceYear = y;
    this._updateListDOM(true);
    this._emitNavigate('today');
    this._emitItemChange(this.selectedYear);
  }

  goToPrevious(): void {
    const target = this._clampYear(this.scale.add(this.referenceYear, -1));
    if (target === this.referenceYear) return; // bloqué à la borne
    this.referenceYear = target;
    this.selectedYear  = target;
    this._updateListDOM(true);
    this._emitNavigate('prev');
    this._emitItemChange(this.selectedYear);
  }

  goToNext(): void {
    const target = this._clampYear(this.scale.add(this.referenceYear, 1));
    if (target === this.referenceYear) return; // bloqué à la borne
    this.referenceYear = target;
    this.selectedYear  = target;
    this._updateListDOM(true);
    this._emitNavigate('next');
    this._emitItemChange(this.selectedYear);
  }

  /** Change l'échelle courante et re-rend la barre alignée dessus */
  setScale(id: ScaleId): void {
    const clampedId = this._clampScaleId(id);
    if (this.scale.id === clampedId) return;
    this.scale = getScale(clampedId);
    let y = this.scale.snap(this.selectedYear);
    if (this.scale.step < 1 && !inDateRange(y)) {
      y = this.scale.snap(todayYear());
    }
    y = this._clampYear(y);
    this.selectedYear  = y;
    this.referenceYear = y;
    this._updateListDOM(false);
    this._emitItemChange(this.selectedYear);
  }

  getScale(): ScaleId { return this.scale.id; }

  /** Renvoie les bornes effectives configurées sur cette instance. */
  getBounds(): { minYear: number; maxYear: number; minScale: ScaleId; maxScale: ScaleId } {
    const finest   = scaleAt(this.finestScaleIdx);
    const coarsest = scaleAt(this.coarsestScaleIdx);
    return {
      minYear:  this.minYear,
      maxYear:  this.maxYear,
      minScale: finest?.id   ?? 'ns',
      maxScale: coarsest?.id ?? 'Ga',
    };
  }

  // ─── Clamp helpers ──────────────────────────────────────────────────────────

  private _clampYear(year: number): number {
    if (year < this.minYear) return this.minYear;
    if (year > this.maxYear) return this.maxYear;
    return year;
  }

  private _clampScaleId(id: ScaleId): ScaleId {
    const idx = scaleIndex(id);
    const clampedIdx = Math.max(this.coarsestScaleIdx, Math.min(this.finestScaleIdx, idx));
    return scaleAt(clampedIdx)?.id ?? id;
  }

  getEventTarget(): EventTarget { return this.container; }

  connectAdapter(adapter: CalendarAdapter): void { this.calendarAdapter = adapter; }

  render(): void {
    this._cleanup();
    this.container.innerHTML = '';
    this._buildDOM();
    this._setupTheme();
    this._bindDragEvents();
    this._bindWheelEvents();
    this._bindKeyboardEvents();
    this._updateListDOM(false);
    this._initResizeObserver();
  }

  destroy(): void {
    this._cleanup();
    this.resizeObserver?.disconnect();
    if (this.rafId           !== void 0) cancelAnimationFrame(this.rafId);
    if (this.springRafId     !== void 0) cancelAnimationFrame(this.springRafId);
    if (this.wheelDebounceId !== void 0) clearTimeout(this.wheelDebounceId);
    if (this._darkMq && this._darkMqHandler) {
      this._darkMq.removeEventListener('change', this._darkMqHandler);
    }
    this.container.innerHTML = '';
  }

  on(
    event: typeof EVENT_WEEK_CHANGE | typeof EVENT_SELECT | typeof EVENT_NAVIGATE,
    handler: EventListener,
  ): () => void {
    this.container.addEventListener(event, handler);
    return () => this.container.removeEventListener(event, handler);
  }

  // ─── DOM ────────────────────────────────────────────────────────────────────

  private _buildDOM(): void {
    this.root = document.createElement('div');
    this.root.className = ['lt', this.compact ? 'lt--compact' : ''].filter(Boolean).join(' ');
    this.root.setAttribute('role', 'toolbar');
    this.root.setAttribute('aria-label', 'Navigation temporelle');

    const header = document.createElement('div');
    header.className = 'lt__header';

    this.listWrapper = document.createElement('div');
    this.listWrapper.className = 'lt__list-wrapper';
    this.listWrapper.tabIndex = 0;
    this.listWrapper.setAttribute('aria-label', 'Glisser ou utiliser la molette pour naviguer');

    this.centerMark = document.createElement('div');
    this.centerMark.className = 'lt__center-mark';
    this.centerMark.setAttribute('aria-hidden', 'true');
    this.listWrapper.appendChild(this.centerMark);

    this.listEl = document.createElement('ol');
    this.listEl.className = 'lt__list';
    this.listEl.setAttribute('role', 'listbox');
    this.listEl.setAttribute('aria-orientation', 'horizontal');

    this.listWrapper.appendChild(this.listEl);
    header.appendChild(this.listWrapper);
    this.root.appendChild(header);
    this.container.appendChild(this.root);
  }

  // ─── List DOM ──────────────────────────────────────────────────────────────

  /**
   * Rend tous les <li> dans listEl à partir de referenceYear / selectedYear
   * et de l'échelle courante. Applique le padding carousel immédiatement.
   */
  private _renderItems(): void {
    const items = this.scale.build(
      this.referenceYear, CAROUSEL_WEEKS, this.selectedYear, this.locale,
    );

    this.listEl.innerHTML = '';
    let prevHeader = '__init__';

    for (const it of items) {
      const isNewHeader = it.header !== '' && it.header !== prevHeader;
      prevHeader = it.header;

      const li = document.createElement('li');
      li.className =
        'lt__item' +
        (it.isSelected ? ' lt__item--selected' : '') +
        (it.isCurrent  ? ' lt__item--current'  : '');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(it.isSelected));
      li.setAttribute('tabindex', it.isSelected ? '0' : '-1');
      li.setAttribute('data-year', String(it.year));

      // Header (équivalent ancien label de mois / année)
      li.setAttribute('data-month-text', it.header);
      li.setAttribute('data-orig-label', isNewHeader ? it.header : '');

      const monthEl = document.createElement('span');
      monthEl.className = 'lt__month-label';
      monthEl.setAttribute('aria-hidden', 'true');
      if (it.isSelected) {
        monthEl.textContent = it.header;
      } else if (isNewHeader) {
        monthEl.textContent = it.header;
      }

      const lbl = document.createElement('span');
      lbl.className = 'lt__item-label';
      lbl.textContent = it.label;

      const sub = document.createElement('span');
      sub.className = 'lt__item-sublabel';
      sub.textContent = it.isCurrent && it.sublabel ? `${it.sublabel} · Auj.` : it.sublabel;

      li.append(monthEl, lbl, sub);

      if (it.isCurrent) {
        const dot = document.createElement('span');
        dot.className = 'lt__item-dot';
        dot.setAttribute('aria-hidden', 'true');
        li.appendChild(dot);
      }

      this.listEl.appendChild(li);
    }

    this._applyCarouselPadding(); // lit offsetWidth → reflow synchrone
  }

  private _updateListDOM(animate: boolean): void {
    this._renderItems();
    this._syncCenterMark();

    const sel = this.listEl.querySelector<HTMLElement>('.lt__item--selected');
    if (sel) {
      this._scrollToItem(sel, animate);
      requestAnimationFrame(() => this._applyScaleEffect());
    }
  }

  // ─── Extension proactive ─────────────────────────────────────────────────────

  /**
   * Vérifie pendant le drag si le centre approche du bord (seuil × 2).
   * Si oui, reconstruit la liste autour de l'item central visible en
   * conservant la position de scroll — le drag continue sans saut.
   */
  private _checkAndExtend(): void {
    if (this._isExtending) return;

    const items = Array.from(this.listEl.querySelectorAll<HTMLElement>('.lt__item'));
    if (items.length === 0) return;

    const wl         = this.listWrapper;
    const viewCenter = wl.scrollLeft + wl.clientWidth / 2;
    const itemStride = items.length > 1 && items[1] && items[0]
      ? items[1].offsetLeft - items[0].offsetLeft : 100;

    // Trouver l'item le plus proche du centre
    let centerIdx = -1;
    let minDist   = Infinity;
    items.forEach((item, i) => {
      const d = Math.abs(item.offsetLeft + item.offsetWidth / 2 - viewCenter);
      if (d < minDist) { minDist = d; centerIdx = i; }
    });
    if (centerIdx === -1) return;

    // Seuil proactif = 2 × EXTEND_THRESHOLD (bien avant le bord)
    const PROACTIVE      = EXTEND_THRESHOLD * 2;
    const scrollRemRight = wl.scrollWidth - wl.clientWidth - wl.scrollLeft;
    const scrollRemLeft  = wl.scrollLeft;

    const nearEdge =
      centerIdx < PROACTIVE ||
      centerIdx >= items.length - PROACTIVE ||
      scrollRemRight < itemStride * PROACTIVE ||
      scrollRemLeft  < itemStride * PROACTIVE;

    if (!nearEdge) return;

    const centerEl  = items[centerIdx];
    if (!centerEl) return;

    const centerYearStr = centerEl.getAttribute('data-year');
    if (!centerYearStr) return;

    this._isExtending = true;

    // Décalage entre le scroll actuel et le scroll "centré sur cet item"
    const scrollOffsetFromCenter =
      wl.scrollLeft - (centerEl.offsetLeft + centerEl.offsetWidth / 2 - wl.clientWidth / 2);

    // Reconstruction autour de l'item central
    this.referenceYear = parseFloat(centerYearStr);
    this._renderItems();
    this._syncCenterMark();

    // Restaurer la position de scroll — même item, même décalage
    const newCenterEl = this.listEl.querySelector<HTMLElement>(`[data-year="${centerYearStr}"]`);
    if (newCenterEl) {
      const newScroll = newCenterEl.offsetLeft + newCenterEl.offsetWidth / 2
        - wl.clientWidth / 2 + scrollOffsetFromCenter;
      wl.scrollLeft = newScroll;

      // Recaler dragStartScroll pour que le prochain pointermove soit cohérent
      if (this.isDragging) {
        this.dragStartScroll = newScroll - (this.dragStartX - this.lastMoveX);
      }
    }

    this._applyScaleEffect();
    this._isExtending = false;
  }

  // ─── Carousel helpers ────────────────────────────────────────────────────────

  private _applyCarouselPadding(): void {
    const ww    = this.listWrapper.clientWidth;
    const items = this.listEl.querySelectorAll<HTMLElement>('.lt__item');
    const first = items[0];
    const last  = items[items.length - 1];
    if (!first || ww === 0) return;

    const padLeft  = Math.max(0, ww / 2 - first.offsetWidth / 2);
    const padRight = Math.max(0, ww / 2 - (last ? last.offsetWidth / 2 : first.offsetWidth / 2));

    this.listEl.style.paddingLeft  = `${padLeft}px`;
    this.listEl.style.paddingRight = `${padRight}px`;
  }

  private _syncCenterMark(): void {
    const item = this.listEl.querySelector<HTMLElement>('.lt__item');
    if (!item) return;
    this.centerMark.style.width  = `${item.offsetWidth}px`;
    this.centerMark.style.height = `${item.offsetHeight}px`;
  }

  private _scrollToItem(el: HTMLElement, animate: boolean, onComplete?: () => void): void {
    const target = el.offsetLeft + el.offsetWidth / 2 - this.listWrapper.clientWidth / 2;

    if (this.rafId !== void 0) { cancelAnimationFrame(this.rafId); this.rafId = void 0; }

    if (animate) {
      this._smoothScrollTo(target, onComplete);
    } else {
      this.listWrapper.scrollLeft = target;
      onComplete?.();
    }
  }

  private _smoothScrollTo(target: number, onComplete?: () => void): void {
    const DURATION = 280;
    const start = this.listWrapper.scrollLeft;
    const diff  = target - start;

    if (Math.abs(diff) < 1) { onComplete?.(); return; }

    const t0 = performance.now();
    const easeOut = (t: number) => 1 - (1 - t) ** 3;

    const tick = (now: number) => {
      const t = Math.min((now - t0) / DURATION, 1);
      this.listWrapper.scrollLeft = start + diff * easeOut(t);

      if (t < 1) {
        this.rafId = requestAnimationFrame(tick);
      } else {
        this.listWrapper.scrollLeft = target;
        this.rafId = void 0;
        onComplete?.();
      }
    };

    this.rafId = requestAnimationFrame(tick);
  }

  private _getCenterItem(): HTMLElement | null {
    const viewCenter = this.listWrapper.scrollLeft + this.listWrapper.clientWidth / 2;
    const items = Array.from(this.listEl.querySelectorAll<HTMLElement>('.lt__item'));
    let closest: HTMLElement | null = null;
    let minDist = Infinity;
    for (const item of items) {
      const d = Math.abs(item.offsetLeft + item.offsetWidth / 2 - viewCenter);
      if (d < minDist) { minDist = d; closest = item; }
    }
    return closest;
  }

  // ─── Scale + opacité (#3) ─────────────────────────────────────────────────

  private _applyScaleEffect(): void {
    const viewCenter = this.listWrapper.scrollLeft + this.listWrapper.clientWidth / 2;
    const maxDist    = this.listWrapper.clientWidth * 0.55;
    this.listEl.querySelectorAll<HTMLElement>('.lt__item').forEach(item => {
      const ratio   = Math.min(Math.abs(item.offsetLeft + item.offsetWidth / 2 - viewCenter) / maxDist, 1);
      const scale   = 1 - ratio * (1 - SCALE_MIN);
      const opacity = 1 - ratio * (1 - OPACITY_MIN);
      item.style.transform = `scale(${scale.toFixed(3)})`;
      item.style.opacity   = opacity.toFixed(3);
    });
  }

  // ─── Spring snap ─────────────────────────────────────────────────────────────

  private _springSnap(el: HTMLElement): void {
    if (this.springRafId !== void 0) { cancelAnimationFrame(this.springRafId); this.springRafId = void 0; }

    const DURATION = 420;
    const A        = 0.10;
    const DECAY    = 7;
    const FREQ     = 2.2;
    const t0       = performance.now();

    const spring = (t: number) => 1 + A * Math.exp(-DECAY * t) * Math.sin(FREQ * Math.PI * t);

    const tick = (now: number) => {
      const t = Math.min((now - t0) / DURATION, 1);
      el.style.transform = `scale(${spring(t).toFixed(4)})`;
      el.style.opacity   = '1';

      if (t < 1) {
        this.springRafId = requestAnimationFrame(tick);
      } else {
        this.springRafId = void 0;
        el.style.transform = 'scale(1)';
      }
    };

    this.springRafId = requestAnimationFrame(tick);
  }

  // ─── Visuals unifiés ─────────────────────────────────────────────────────────

  private _updateVisuals(): void {
    this._updateCenterHighlight();
    this._applyScaleEffect();
  }

  private _scheduleVisuals(): void {
    if (this.rafId !== void 0) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = void 0;
      this._checkAndExtend();
      this._updateVisuals();
    });
  }

  private _updateCenterHighlight(): void {
    const closest = this._getCenterItem();
    if (!closest) return;

    this.listEl.querySelectorAll<HTMLElement>('.lt__item').forEach(item => {
      const sel = item === closest;
      const wasSelected = item.classList.contains('lt__item--selected');
      item.classList.toggle('lt__item--selected', sel);
      item.setAttribute('aria-selected', String(sel));
      item.tabIndex = sel ? 0 : -1;

      if (sel === wasSelected) return;
      const monthEl = item.querySelector<HTMLElement>('.lt__month-label');
      if (!monthEl) return;

      if (sel) {
        monthEl.textContent = item.getAttribute('data-month-text') ?? '';
      } else {
        monthEl.textContent = item.getAttribute('data-orig-label') ?? '';
      }
    });

    const centerYearStr = closest.getAttribute('data-year');
    if (centerYearStr) {
      const y = parseFloat(centerYearStr);
      this._emitItemPreview(y);
      if (this.onWeekPreviewCb && inDateRange(y)) {
        const date  = normalizeDate(yearToDate(y));
        const start = getWeekStart(date, this.firstDayOfWeek);
        this.onWeekPreviewCb({ date: cloneDate(date), week: { start, end: getWeekEnd(start) } });
      }
    }
  }

  // ─── Drag (Pointer Events) ───────────────────────────────────────────────────

  private _bindDragEvents(): void {
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (this.rafId     !== void 0) { cancelAnimationFrame(this.rafId);     this.rafId     = void 0; }
      if (this.springRafId !== void 0) { cancelAnimationFrame(this.springRafId); this.springRafId = void 0; }

      this.listWrapper.setPointerCapture(e.pointerId);
      this.isDragging      = true;
      this.dragStartX      = e.clientX;
      this.dragStartScroll = this.listWrapper.scrollLeft;
      this.velX            = 0;
      this.lastMoveX       = e.clientX;
      this.lastMoveT       = performance.now();
      this.listWrapper.classList.add('is-dragging');
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!this.isDragging) return;
      this.listWrapper.scrollLeft = this.dragStartScroll + (this.dragStartX - e.clientX);

      const now = performance.now();
      const dt  = now - this.lastMoveT;
      if (dt > 0 && dt < 100) this.velX = (this.lastMoveX - e.clientX) / dt;
      this.lastMoveX = e.clientX;
      this.lastMoveT = now;

      this._scheduleVisuals();
    };

    const onPointerUp = () => {
      if (!this.isDragging) return;
      this.isDragging = false;
      this.listWrapper.classList.remove('is-dragging');
      this._startMomentum();
    };

    this.listWrapper.addEventListener('pointerdown',   onPointerDown);
    this.listWrapper.addEventListener('pointermove',   onPointerMove);
    this.listWrapper.addEventListener('pointerup',     onPointerUp);
    this.listWrapper.addEventListener('pointercancel', onPointerUp);

    this.cleanupFns.push(
      () => this.listWrapper.removeEventListener('pointerdown',   onPointerDown),
      () => this.listWrapper.removeEventListener('pointermove',   onPointerMove),
      () => this.listWrapper.removeEventListener('pointerup',     onPointerUp),
      () => this.listWrapper.removeEventListener('pointercancel', onPointerUp),
    );
  }

  // ─── Molette souris ─────────────────────────────────────────────────────────

  private _bindWheelEvents(): void {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (this.wheelDebounceId !== void 0) return;

      this.wheelDebounceId = window.setTimeout(() => {
        this.wheelDebounceId = void 0;
      }, WHEEL_DEBOUNCE_MS);

      if (e.deltaY > 0 || e.deltaX > 0) this.goToNext();
      else this.goToPrevious();
    };

    this.listWrapper.addEventListener('wheel', onWheel, { passive: false });
    this.cleanupFns.push(() => this.listWrapper.removeEventListener('wheel', onWheel));
  }

  // ─── Momentum ──────────────────────────────────────────────────────────────

  private _startMomentum(): void {
    if (Math.abs(this.velX) < MOMENTUM_MIN_VEL) { this._snapToCenter(); return; }

    const tick = () => {
      this.velX *= MOMENTUM_FRICTION;
      this.listWrapper.scrollLeft += this.velX * 16;
      this._updateVisuals();

      if (Math.abs(this.velX) < MOMENTUM_MIN_VEL) {
        this.rafId = void 0;
        this._snapToCenter();
        return;
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  // ─── Snap ───────────────────────────────────────────────────────────────────

  private _snapToCenter(): void {
    const closest = this._getCenterItem();
    if (!closest) return;

    const yearStr = closest.getAttribute('data-year');
    if (!yearStr) return;

    const year  = parseFloat(yearStr);
    const items = Array.from(this.listEl.querySelectorAll<HTMLElement>('.lt__item'));
    const idx   = items.indexOf(closest);

    this._commitSelection(year);
    this._hapticFeedback();

    // Fallback : si l'extension proactive n'a pas pu se déclencher
    const itemStride     = items.length > 1 && items[1] && items[0]
      ? items[1].offsetLeft - items[0].offsetLeft : 100;
    const wl             = this.listWrapper;
    const scrollRemRight = wl.scrollWidth - wl.clientWidth - wl.scrollLeft;
    const scrollRemLeft  = wl.scrollLeft;

    const atEdge =
      idx < EXTEND_THRESHOLD ||
      idx >= items.length - EXTEND_THRESHOLD ||
      scrollRemRight < itemStride * 2 ||
      scrollRemLeft  < itemStride * 2;

    if (atEdge) {
      this.referenceYear = this.selectedYear;
      this._updateListDOM(false);
      const newSel = this.listEl.querySelector<HTMLElement>('.lt__item--selected');
      if (newSel) this._springSnap(newSel);
      return;
    }

    this._scrollToItem(closest, true, () => {
      this._applyScaleEffect();
      this._springSnap(closest);
    });
  }

  // ─── Keyboard ───────────────────────────────────────────────────────────────

  private _bindKeyboardEvents(): void {
    const onKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft':  e.preventDefault(); this.goToPrevious(); break;
        case 'ArrowRight': e.preventDefault(); this.goToNext();     break;
        case 'Home':       e.preventDefault(); this.goToToday();    break;
      }
    };
    this.listWrapper.addEventListener('keydown', onKeyDown);
    this.cleanupFns.push(() => this.listWrapper.removeEventListener('keydown', onKeyDown));
  }

  // ─── Selection ──────────────────────────────────────────────────────────────

  /** Construit un TimelineItemInfo pour un year donné, à l'échelle courante. */
  private _buildItemInfo(year: number): TimelineItemInfo | null {
    const items = this.scale.build(year, 1, year, this.locale);
    const item = items[0];
    if (!item) return null;
    return {
      scale: this.scale.id,
      year: item.year,
      label: item.label,
      sublabel: item.sublabel,
      header: item.header,
      date: inDateRange(item.year) ? yearToDate(item.year) : null,
    };
  }

  private _emitItemChange(year: number): void {
    if (!this.onItemChangeCb) return;
    const info = this._buildItemInfo(year);
    if (info) this.onItemChangeCb(info);
  }

  private _emitItemPreview(year: number): void {
    if (!this.onItemPreviewCb) return;
    const info = this._buildItemInfo(year);
    if (info) this.onItemPreviewCb(info);
  }

  private _commitSelection(year: number): void {
    const clamped = this._clampYear(year);
    this.selectedYear  = clamped;
    this.referenceYear = clamped;
    this._writeStorage();
    this._emitItemChange(clamped);

    // Reassign 'year' var so the rest du flow utilise la valeur clampée
    year = clamped;

    // Callbacks Date-based : seulement quand le year est dans la plage Date
    if (!inDateRange(year)) return;

    const date  = normalizeDate(yearToDate(year));
    const start = getWeekStart(date, this.firstDayOfWeek);
    const detail: LadderTimelineSelectEventDetail = {
      date: cloneDate(date),
      week: { start, end: getWeekEnd(start) },
    };

    this.container.dispatchEvent(createWeekChangeEvent(detail));
    this.container.dispatchEvent(createSelectEvent(detail));
    this.onWeekChangeCb?.(detail);
    this.calendarAdapter?.gotoDate(detail.week.start);
  }

  private _emitNavigate(direction: 'prev' | 'next' | 'today'): void {
    if (!inDateRange(this.selectedYear)) return;
    const date  = normalizeDate(yearToDate(this.selectedYear));
    const start = getWeekStart(date, this.firstDayOfWeek);
    this.container.dispatchEvent(
      createNavigateEvent({ direction, date: cloneDate(date), week: { start, end: getWeekEnd(start) } }),
    );
  }

  // ─── Feedback haptique mobile ───────────────────────────────────────────────

  private _hapticFeedback(): void {
    if ('vibrate' in navigator) navigator.vibrate(8);
  }

  // ─── Thème ──────────────────────────────────────────────────────────────────

  private _setupTheme(): void {
    if (this._darkMq && this._darkMqHandler) {
      this._darkMq.removeEventListener('change', this._darkMqHandler);
      this._darkMqHandler = void 0;
      this._darkMq        = void 0;
    }

    if (this.theme === 'dark') {
      this.root.classList.add('lt--dark');
    } else if (this.theme === 'auto' && 'matchMedia' in window) {
      this._darkMq = window.matchMedia('(prefers-color-scheme: dark)');
      this.root.classList.toggle('lt--dark', this._darkMq.matches);
      this._darkMqHandler = (e: MediaQueryListEvent) => {
        this.root.classList.toggle('lt--dark', e.matches);
      };
      this._darkMq.addEventListener('change', this._darkMqHandler);
    }
  }

  // ─── Persistence ────────────────────────────────────────────────────────────

  private _readStorage(): number | null {
    if (!this.storageKey) return null;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return null;
      const n = parseFloat(raw);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  private _writeStorage(): void {
    if (!this.storageKey) return;
    try {
      localStorage.setItem(this.storageKey, String(this.selectedYear));
    } catch {
      // quota dépassé ou mode privé
    }
  }

  // ─── Resize ─────────────────────────────────────────────────────────────────

  private _initResizeObserver(): void {
    if (!('ResizeObserver' in window)) return;
    this.resizeObserver = new ResizeObserver(() => {
      this._applyCarouselPadding();
      this._syncCenterMark();
      const sel = this.listEl.querySelector<HTMLElement>('.lt__item--selected');
      if (sel) { this._scrollToItem(sel, false); this._applyScaleEffect(); }
    });
    this.resizeObserver.observe(this.listWrapper);
  }

  // ─── Debug ──────────────────────────────────────────────────────────────────

  debugState(): Record<string, unknown> {
    const items  = Array.from(this.listEl?.querySelectorAll<HTMLElement>('.lt__item') ?? []);
    const wl     = this.listWrapper;
    const scroll = wl?.scrollLeft ?? 0;
    const cw     = wl?.clientWidth ?? 0;
    const sw     = wl?.scrollWidth ?? 0;
    const viewCenter = scroll + cw / 2;

    let centerIdx = -1;
    let minDist   = Infinity;
    items.forEach((item, i) => {
      const d = Math.abs(item.offsetLeft + item.offsetWidth / 2 - viewCenter);
      if (d < minDist) { minDist = d; centerIdx = i; }
    });

    const selIdx   = items.findIndex(el => el.classList.contains('lt__item--selected'));
    const firstY   = items[0]?.getAttribute('data-year') ?? '—';
    const lastY    = items[items.length - 1]?.getAttribute('data-year') ?? '—';
    const maxScroll = sw - cw;

    const centerItem = items[centerIdx];
    const centerY    = centerItem?.getAttribute('data-year') ?? '—';

    const selItem = items[selIdx];
    const selY    = selItem?.getAttribute('data-year') ?? '—';

    const distToMax     = Math.round(maxScroll - scroll);
    const nearEdgeRight = centerIdx > items.length - 1 - EXTEND_THRESHOLD;
    const nearEdgeLeft  = centerIdx < EXTEND_THRESHOLD;

    const itemW = (items[1] && items[0])
      ? items[1].offsetLeft - items[0].offsetLeft
      : 0;

    const weeksToRight = items.length - 1 - centerIdx;
    const weeksToLeft  = centerIdx;

    return {
      scale:          this.scale.id,
      selectedYear:   this.selectedYear,
      referenceYear:  this.referenceYear,
      isDragging:     this.isDragging,
      rafActive:      this.rafId !== void 0,
      velX:           +this.velX.toFixed(3),

      scrollLeft:     Math.round(scroll),
      maxScrollLeft:  Math.round(maxScroll),
      distToRight:    distToMax,
      scrollWidth:    Math.round(sw),
      clientWidth:    Math.round(cw),
      paddingLeft:    this.listEl?.style.paddingLeft  ?? '?',
      paddingRight:   this.listEl?.style.paddingRight ?? '?',
      itemWidth:      Math.round(itemW),

      totalItems:     items.length,
      weeksToLeft,
      weeksToRight,

      centerIdx,
      centerYear:     centerY,
      selIdx,
      selYear:        selY,
      centerMatchSel: centerIdx === selIdx,

      EXTEND_THRESHOLD,
      nearEdgeLeft,
      nearEdgeRight,
      extendWillFire: nearEdgeLeft || nearEdgeRight,

      firstYear:      firstY,
      lastYear:       lastY,
    };
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────────

  private _cleanup(): void {
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
  }
}
