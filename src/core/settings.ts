import { loadJSON, saveJSON } from './storage';

export interface Settings {
  muted: boolean;
  /** 'auto' follows the OS prefers-reduced-motion setting. */
  motion: 'auto' | 'full' | 'reduced';
}

const KEY = 'keystorm.settings.v1';
const DEFAULTS: Settings = { muted: false, motion: 'auto' };

const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

export class SettingsStore {
  data: Settings;
  private listeners: Array<() => void> = [];

  constructor() {
    const loaded = loadJSON<Partial<Settings>>(KEY, {});
    this.data = { ...DEFAULTS, ...loaded };
    mq?.addEventListener?.('change', () => this.notify());
  }

  get reducedMotion(): boolean {
    if (this.data.motion === 'auto') return !!mq?.matches;
    return this.data.motion === 'reduced';
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.data[key] = value;
    saveJSON(KEY, this.data);
    this.notify();
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}
