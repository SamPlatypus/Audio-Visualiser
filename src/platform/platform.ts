/** Thin, defensive wrappers around browser APIs that vary across mobile platforms. */

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenEnabled?: boolean;
};
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export const fullscreen = {
  /** True when the Fullscreen API is usable (not on iPhone Safari). */
  get supported(): boolean {
    const d = document as FsDocument;
    return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
  },
  get active(): boolean {
    const d = document as FsDocument;
    return !!(d.fullscreenElement || d.webkitFullscreenElement);
  },
  async enter(el: HTMLElement = document.documentElement): Promise<boolean> {
    const e = el as FsElement;
    try {
      if (e.requestFullscreen) await e.requestFullscreen({ navigationUI: 'hide' });
      else if (e.webkitRequestFullscreen) await e.webkitRequestFullscreen();
      else return false;
      return true;
    } catch {
      return false;
    }
  },
  async exit(): Promise<void> {
    const d = document as FsDocument;
    try {
      if (d.exitFullscreen) await d.exitFullscreen();
      else await d.webkitExitFullscreen?.();
    } catch {
      /* already exited */
    }
  },
  onChange(fn: () => void): void {
    document.addEventListener('fullscreenchange', fn);
    document.addEventListener('webkitfullscreenchange', fn);
  },
};

/** True when launched from the home screen / as an installed app. */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isNativeShell(): boolean {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

/** Keeps the screen on while visualising, re-acquiring after the tab returns. */
export class WakeLock {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.wanted) void this.acquire();
    });
  }

  async set(on: boolean): Promise<void> {
    this.wanted = on;
    if (on) await this.acquire();
    else await this.release();
  }

  private async acquire(): Promise<void> {
    if (this.sentinel || !('wakeLock' in navigator)) return;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
      });
    } catch {
      /* low battery, not visible, or unsupported */
    }
  }

  private async release(): Promise<void> {
    const s = this.sentinel;
    this.sentinel = null;
    try {
      await s?.release();
    } catch {
      /* ignore */
    }
  }
}

export interface MediaHandlers {
  play: () => void;
  pause: () => void;
  next?: () => void;
  previous?: () => void;
  seek?: (t: number) => void;
}

/** Lock-screen / notification controls for file playback. */
export const mediaSession = {
  get supported(): boolean {
    return 'mediaSession' in navigator;
  },
  setTrack(title: string, artist: string): void {
    if (!this.supported) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album: 'Auralis' });
    } catch {
      /* ignore */
    }
  },
  setState(state: 'playing' | 'paused' | 'none'): void {
    if (!this.supported) return;
    navigator.mediaSession.playbackState = state;
  },
  setPosition(position: number, duration: number): void {
    if (!this.supported || !navigator.mediaSession.setPositionState || !(duration > 0)) return;
    try {
      navigator.mediaSession.setPositionState({ duration, position: Math.min(position, duration), playbackRate: 1 });
    } catch {
      /* ignore */
    }
  },
  bind(h: MediaHandlers): void {
    if (!this.supported) return;
    const set = (action: MediaSessionAction, fn: MediaSessionActionHandler | null) => {
      try {
        navigator.mediaSession.setActionHandler(action, fn);
      } catch {
        /* action not supported */
      }
    };
    set('play', () => h.play());
    set('pause', () => h.pause());
    set('nexttrack', h.next ? () => h.next!() : null);
    set('previoustrack', h.previous ? () => h.previous!() : null);
    set('seekto', h.seek ? (d) => d.seekTime !== undefined && h.seek!(d.seekTime) : null);
  },
};

export const haptic = (ms = 8): void => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* ignore */
  }
};
