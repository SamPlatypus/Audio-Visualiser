export interface GestureHandlers {
  /** Single tap. `wasHidden` tells whether controls were hidden at the time. */
  tap: () => void;
  doubleTap: () => void;
  swipe: (dir: 'left' | 'right' | 'up' | 'down') => void;
  /** Any touch / pointer activity on the stage. */
  activity: () => void;
}

const SWIPE_MIN = 56; // CSS px
const SWIPE_MAX_TIME = 700; // ms
const TAP_SLOP = 14;
const TAP_TIME = 320;
const DOUBLE_TAP_GAP = 300;

/**
 * Tap / double-tap / swipe recognition on the visualizer surface using
 * Pointer Events (works for touch, pen and mouse).
 *
 * A single tap is delayed until the double-tap window passes, but only when
 * `delayTap()` says so (e.g. when controls are visible) — revealing hidden
 * controls should feel instant.
 */
export function attachGestures(el: HTMLElement, h: GestureHandlers, delayTap: () => boolean): void {
  let startX = 0;
  let startY = 0;
  let startT = 0;
  let activeId: number | null = null;
  let multi = false;
  let lastTapT = 0;
  let lastTapX = 0;
  let lastTapY = 0;
  let tapTimer: number | null = null;
  let pointers = 0;

  el.addEventListener('pointerdown', (e) => {
    pointers++;
    h.activity();
    if (activeId !== null) {
      multi = true;
      return;
    }
    activeId = e.pointerId;
    multi = false;
    startX = e.clientX;
    startY = e.clientY;
    startT = performance.now();
  });

  const end = (e: PointerEvent, cancelled: boolean) => {
    pointers = Math.max(0, pointers - 1);
    if (e.pointerId !== activeId) return;
    activeId = null;
    if (cancelled || multi) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const dt = performance.now() - startT;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);

    if (dt < SWIPE_MAX_TIME && Math.max(ax, ay) >= SWIPE_MIN) {
      if (ax > ay * 1.4) h.swipe(dx < 0 ? 'left' : 'right');
      else if (ay > ax * 1.4) h.swipe(dy < 0 ? 'up' : 'down');
      return;
    }
    if (ax > TAP_SLOP || ay > TAP_SLOP || dt > TAP_TIME) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const now = performance.now();
    const isDouble =
      now - lastTapT < DOUBLE_TAP_GAP && Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 40;
    if (isDouble) {
      if (tapTimer !== null) {
        clearTimeout(tapTimer);
        tapTimer = null;
      }
      lastTapT = 0;
      h.doubleTap();
      return;
    }
    lastTapT = now;
    lastTapX = e.clientX;
    lastTapY = e.clientY;
    if (delayTap()) {
      tapTimer = window.setTimeout(() => {
        tapTimer = null;
        h.tap();
      }, DOUBLE_TAP_GAP);
    } else {
      h.tap();
    }
  };

  el.addEventListener('pointerup', (e) => end(e, false));
  el.addEventListener('pointercancel', (e) => end(e, true));
  el.addEventListener('pointermove', () => {
    if (pointers === 0) h.activity(); // mouse hover reveals controls on desktop
  });
  // Block the long-press context menu on mobile.
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
