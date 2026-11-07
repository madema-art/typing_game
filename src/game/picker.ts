import type { Coach } from './coach';
import type { Profile } from './profile';
import { isValidText } from './text/charset';
import { JOKES, SENTENCES } from './text/bank';
import { SentenceGenerator } from './text/generator';
import { buildPassage, difficulty, focusValue, parseMarked, type Passage, type RawPart } from './text/passage';
import { LEXICON, LEXICON_BY_WORD, type VocabEntry } from './text/vocab';

interface Candidate {
  id: string;
  kind: RawPart['kind'];
  raw: string;
  text: string;
  d: number;
}

const BANK: Candidate[] = [
  ...SENTENCES.map((raw, i) => ({ id: `s${i}`, kind: 'bank' as const, raw, text: raw, d: difficulty(raw) })),
  ...JOKES.map((raw, i) => ({ id: `j${i}`, kind: 'joke' as const, raw, text: raw, d: difficulty(raw) })),
].filter((c) => isValidText(c.text));

/** How good the player is right now, 0..1, plus how far into the run they are. */
export function skillLevel(profile: Profile, wave: number): number {
  const wpm = profile.wpm;
  const acc = profile.data.acc;
  const skill = Math.max(0, Math.min(1, (wpm - 15) / 60)) * 0.75 + Math.max(0, Math.min(1, (acc - 0.85) / 0.13)) * 0.25;
  return Math.max(0, Math.min(1, skill + (wave - 1) * 0.03));
}

/**
 * Chooses what the next transmission says. Balances: difficulty that fits the
 * player, practice value for their weak keys and letter pairs, vocabulary
 * (spaced-repetition reviews first, then new words), and novelty.
 */
export class Picker {
  private gen: SentenceGenerator;
  private sessionUsed = new Set<string>();
  private newWordsThisRun = 0;
  private sincePassageVocab = 0;
  /** Words introduced this run that should come back in a fresh sentence soon. */
  private reviewSoon: Array<{ word: string; after: number }> = [];
  private passages = 0;

  constructor(private profile: Profile, private coach: Coach) {
    this.gen = new SentenceGenerator((k) => this.coach.weight(k));
  }

  reset(): void {
    this.sessionUsed.clear();
    this.newWordsThisRun = 0;
    this.sincePassageVocab = 0;
    this.reviewSoon = [];
    this.passages = 0;
  }

  next(wave: number, opts: { demo?: boolean } = {}): Passage {
    if (opts.demo) {
      const short = BANK.filter((c) => c.kind === 'bank' && c.text.length <= 42 && !this.sessionUsed.has(c.id));
      const c = short[Math.floor(Math.random() * short.length)] ?? BANK[0];
      this.sessionUsed.add(c.id);
      return buildPassage([{ id: c.id, kind: c.kind, raw: c.raw }]);
    }

    this.passages++;
    const level = skillLevel(this.profile, wave);
    const target = 0.7 + level * 1.6;
    const parts: RawPart[] = [];

    // How many sentences in this transmission.
    let count = 1;
    if (wave >= 2 && level > 0.3) count = Math.random() < 0.35 + level * 0.3 ? 2 : 1;
    if (wave >= 4 && level > 0.65 && Math.random() < 0.3) count = 3;
    const maxLen = 60 + level * 100 + Math.min(wave, 8) * 5;

    // Vocabulary: roughly every other transmission, sooner if a review is due.
    const vocab = this.pickVocab(level);
    if (vocab) parts.push(vocab);

    while (parts.length < count) {
      const remaining = maxLen - parts.reduce((s, p) => s + parseMarked(p.raw).text.length + 1, 0);
      const hasJoke = parts.some((p) => p.kind === 'joke');
      const c = this.pickCandidate(target, remaining, parts.length > 0, hasJoke);
      if (!c) break;
      parts.push({ id: c.id, kind: c.kind, raw: c.raw });
      this.sessionUsed.add(c.id);
      this.profile.rememberUsed(c.id);
    }
    if (parts.length === 0) {
      const c = BANK[Math.floor(Math.random() * BANK.length)];
      parts.push({ id: c.id, kind: c.kind, raw: c.raw });
    }
    // Vocabulary sentences read better after a lead-in, but jokes should end the transmission.
    parts.sort((a, b) => (a.kind === 'joke' ? 1 : 0) - (b.kind === 'joke' ? 1 : 0));
    return buildPassage(parts);
  }

  private pickCandidate(target: number, maxLen: number, secondary: boolean, noJokes: boolean): Candidate | null {
    const weight = (k: string) => this.coach.weight(k);
    const bigram = (pair: string) => this.profile.bigramWeakness(pair);
    const focusOn = this.coach.focus.size > 0;
    const pool: Candidate[] = BANK.filter(
      (c) => c.text.length <= maxLen && !(noJokes && c.kind === 'joke') && !this.sessionUsed.has(c.id) && !this.profile.recentlyUsed(c.id),
    );
    // Generated sentences: more of them when there are keys to drill.
    const genCount = focusOn ? 8 : 3;
    for (let i = 0; i < genCount; i++) {
      const text = this.gen.generate();
      if (isValidText(text) && text.length <= maxLen) pool.push({ id: `g:${text}`, kind: 'gen', raw: text, text, d: difficulty(text) });
    }
    if (!pool.length) return null;
    let best: Candidate | null = null;
    let bestScore = -Infinity;
    for (const c of pool) {
      const fit = -Math.abs(c.d - (secondary ? target * 0.8 : target)) * 1.2;
      const focus = focusValue(c.text, weight, bigram) * (focusOn ? 1.6 : 0.8);
      const humor = c.kind === 'joke' ? 0.12 : c.kind === 'gen' ? -0.05 : 0.1;
      const score = fit + focus + humor + Math.random() * 0.45;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  private pickVocab(level: number): RawPart | null {
    this.sincePassageVocab++;
    const now = Date.now();
    let entry: VocabEntry | undefined;
    let isNew = false;

    // 1) A word introduced earlier this run, now coming back in a new sentence.
    const soon = this.reviewSoon.findIndex((r) => this.passages >= r.after);
    if (soon >= 0) {
      entry = LEXICON_BY_WORD.get(this.reviewSoon[soon].word);
      this.reviewSoon.splice(soon, 1);
    }
    // 2) Words due for spaced-repetition review.
    if (!entry && this.sincePassageVocab >= 2) {
      const due = this.profile.dueVocab(now);
      if (due.length && Math.random() < 0.7) entry = LEXICON_BY_WORD.get(due[0]);
    }
    // 3) A brand-new word, matched to the player's level.
    if (!entry && this.sincePassageVocab >= 2 && this.newWordsThisRun < 8 && Math.random() < 0.6) {
      const maxLevel = level < 0.35 ? 1 : level < 0.7 ? 2 : 3;
      const unseen = LEXICON.filter((e) => !this.profile.vocabState(e.word) && e.level <= maxLevel);
      if (unseen.length) {
        entry = unseen[Math.floor(Math.random() * unseen.length)];
        isNew = true;
        this.newWordsThisRun++;
        // Bring it back a few transmissions later, in a different sentence.
        this.reviewSoon.push({ word: entry.word, after: this.passages + 2 + Math.floor(Math.random() * 2) });
      }
    }
    if (!entry) return null;
    this.sincePassageVocab = 0;

    // Prefer a context sentence the player hasn't seen yet.
    const seen = this.profile.vocabState(entry.word)?.ctx ?? [];
    const fresh = entry.contexts.map((_, i) => i).filter((i) => !seen.includes(i) && !this.sessionUsed.has(`v:${entry!.word}:${i}`));
    const options = fresh.length ? fresh : entry.contexts.map((_, i) => i);
    const context = options[Math.floor(Math.random() * options.length)];
    this.sessionUsed.add(`v:${entry.word}:${context}`);
    return { id: `v:${entry.word}:${context}`, kind: 'vocab', raw: entry.contexts[context], vocab: { entry, context, isNew } };
  }
}
