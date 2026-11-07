import { loadJSON, saveJSON } from '../core/storage';
import { keyOf } from './text/charset';

/**
 * The player's long-term typing model, saved in the browser. It remembers how
 * accurate and how fast every key and letter pair is, which keys get confused,
 * overall speed, streaks, records and vocabulary progress.
 */

export interface KeyStat {
  /** Times this key was the expected key. */
  n: number;
  /** Times it was mistyped. */
  err: number;
  /** Smoothed time to reach this key from the previous one (ms), correct strokes only. */
  ms: number;
  /** Current run of correct strokes on this key. */
  run: number;
}

export interface VocabState {
  /** Times met in a sentence. */
  seen: number;
  /** Times typed without a mistake. */
  clean: number;
  /** Spaced-repetition box: 0 = new ... 5 = mastered. */
  box: number;
  /** When it should come back (epoch ms). */
  due: number;
  /** Context sentences already shown. */
  ctx: number[];
}

export interface ProfileData {
  v: 1;
  keys: Record<string, KeyStat>;
  bigrams: Record<string, { n: number; err: number }>;
  confusions: Record<string, number>;
  /** Smoothed characters per second. */
  cps: number;
  /** Smoothed accuracy (0..1). */
  acc: number;
  passages: number;
  chars: number;
  sessions: number;
  records: { bestWpm: number; bestPassageWpm: number; bestPerfectStreak: number; bestCombo: number };
  day: { last: string; streak: number; best: number };
  vocab: Record<string, VocabState>;
  recent: string[];
}

const KEY = 'keystorm.profile.v1';
const DAY = 86_400_000;
/** Review intervals per spaced-repetition box (box 1 = later this session). */
const INTERVALS = [0, 2 * 60_000, DAY, 3 * DAY, 7 * DAY, 21 * DAY];

function fresh(): ProfileData {
  return {
    v: 1,
    keys: {},
    bigrams: {},
    confusions: {},
    cps: 2.0,
    acc: 0.92,
    passages: 0,
    chars: 0,
    sessions: 0,
    records: { bestWpm: 0, bestPassageWpm: 0, bestPerfectStreak: 0, bestCombo: 0 },
    day: { last: '', streak: 0, best: 0 },
    vocab: {},
    recent: [],
  };
}

const localDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export class Profile {
  data: ProfileData;

  constructor() {
    const loaded = loadJSON<ProfileData | null>(KEY, null);
    this.data = loaded && loaded.v === 1 ? { ...fresh(), ...loaded, records: { ...fresh().records, ...loaded.records } } : fresh();
  }

  save(): void {
    const d = this.data;
    // Keep storage small: drop the least-used letter pairs.
    const pairs = Object.entries(d.bigrams);
    if (pairs.length > 500) {
      pairs.sort((a, b) => b[1].n - a[1].n);
      d.bigrams = Object.fromEntries(pairs.slice(0, 400));
    }
    d.recent = d.recent.slice(-120);
    saveJSON(KEY, d);
  }

  reset(): void {
    this.data = fresh();
    this.save();
  }

  get isNew(): boolean {
    return this.data.passages < 2;
  }

  get wpm(): number {
    return this.data.cps * 12;
  }

  // ------------------------------------------------------------------ keystrokes

  record(expected: string, typed: string, prev: string, latencyMs: number | null): void {
    const k = keyOf(expected);
    const ok = expected === typed;
    const s = (this.data.keys[k] ??= { n: 0, err: 0, ms: 0, run: 0 });
    s.n++;
    if (ok) {
      s.run++;
      if (latencyMs !== null && latencyMs > 30 && latencyMs < 2500) s.ms = s.ms ? s.ms * 0.85 + latencyMs * 0.15 : latencyMs;
    } else {
      s.err++;
      s.run = 0;
      const pair = `${k}>${keyOf(typed)}`;
      this.data.confusions[pair] = (this.data.confusions[pair] ?? 0) + 1;
    }
    if (prev) {
      const bg = keyOf(prev) + k;
      const b = (this.data.bigrams[bg] ??= { n: 0, err: 0 });
      b.n++;
      if (!ok) b.err++;
    }
  }

  /** Median smoothed latency across well-practised keys. */
  private medianMs(): number {
    const v = Object.values(this.data.keys)
      .filter((s) => s.n >= 8 && s.ms > 0)
      .map((s) => s.ms)
      .sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : 0;
  }

  /** 0 = solid ... ~1+ = needs work. Combines error rate (with a prior) and slowness. */
  weakness(key: string): number {
    const s = this.data.keys[key];
    if (!s || s.n < 3) return 0;
    const errRate = (s.err + 0.3) / (s.n + 6);
    const med = this.medianMs();
    const slow = med && s.ms ? Math.max(0, Math.min(1.5, s.ms / med - 1)) : 0;
    return errRate * 5 + slow * 0.35;
  }

  bigramWeakness(pair: string): number {
    const b = this.data.bigrams[pair];
    if (!b || b.n < 3) return 0;
    return ((b.err + 0.2) / (b.n + 5)) * 5;
  }

  weakKeys(n: number): string[] {
    return Object.keys(this.data.keys)
      .filter((k) => this.data.keys[k].n >= 6 && this.weakness(k) > 0.35)
      .sort((a, b) => this.weakness(b) - this.weakness(a))
      .slice(0, n);
  }

  strongKeys(n: number): string[] {
    return Object.keys(this.data.keys)
      .filter((k) => k !== ' ' && this.data.keys[k].n >= 15)
      .sort((a, b) => this.weakness(a) - this.weakness(b))
      .slice(0, n);
  }

  topConfusions(n: number): Array<{ expected: string; typed: string; count: number }> {
    return Object.entries(this.data.confusions)
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([pair, count]) => {
        const [expected, typed] = pair.split('>');
        return { expected, typed, count };
      });
  }

  // ------------------------------------------------------------------ passages & records

  /** Fold one finished passage into the long-term speed/accuracy estimate. */
  recordPassage(cps: number, accuracy: number, chars: number): void {
    const d = this.data;
    if (chars >= 10 && cps > 0.3 && cps < 25) {
      const a = d.passages < 3 ? 0.5 : 0.22;
      d.cps = d.cps * (1 - a) + cps * a;
    }
    d.acc = d.acc * 0.8 + accuracy * 0.2;
    d.passages++;
    d.chars += chars;
    d.records.bestPassageWpm = Math.max(d.records.bestPassageWpm, Math.round(cps * 12));
  }

  /** Count today toward the daily streak. Returns the streak. */
  touchDay(now = new Date()): number {
    const d = this.data.day;
    const today = localDay(now);
    if (d.last !== today) {
      const yesterday = localDay(new Date(now.getTime() - DAY));
      d.streak = d.last === yesterday ? d.streak + 1 : 1;
      d.last = today;
      d.best = Math.max(d.best, d.streak);
      this.data.sessions++;
    }
    return d.streak;
  }

  rememberUsed(id: string): void {
    this.data.recent.push(id);
  }

  recentlyUsed(id: string, window = 80): boolean {
    const r = this.data.recent;
    return r.lastIndexOf(id) >= Math.max(0, r.length - window);
  }

  // ------------------------------------------------------------------ vocabulary (spaced repetition)

  vocabState(word: string): VocabState | undefined {
    return this.data.vocab[word];
  }

  /** A lexicon word was met. Clean typing moves it up a box; a miss moves it back. */
  vocabMet(word: string, context: number, clean: boolean, now = Date.now()): VocabState {
    const v = (this.data.vocab[word] ??= { seen: 0, clean: 0, box: 0, due: 0, ctx: [] });
    v.seen++;
    if (!v.ctx.includes(context)) v.ctx.push(context);
    if (clean) {
      v.clean++;
      v.box = Math.min(5, v.box + 1);
    } else {
      v.box = Math.max(1, v.box - 1);
    }
    v.due = now + INTERVALS[v.box];
    return v;
  }

  dueVocab(now = Date.now()): string[] {
    return Object.entries(this.data.vocab)
      .filter(([, v]) => v.box < 5 && v.due <= now)
      .sort((a, b) => a[1].due - b[1].due)
      .map(([w]) => w);
  }

  get vocabCollected(): number {
    return Object.keys(this.data.vocab).length;
  }

  get vocabMastered(): number {
    return Object.values(this.data.vocab).filter((v) => v.box >= 4).length;
  }
}
