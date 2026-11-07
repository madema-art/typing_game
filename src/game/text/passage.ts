import { keyOf } from './charset';
import type { VocabEntry } from './vocab';

/** One space-separated word of a passage (punctuation attached), carried by one ship. */
export interface Token {
  text: string;
  /** Character range in the passage text [start, end). */
  start: number;
  end: number;
  /** Index of the sentence (passage part) this token belongs to. */
  part: number;
  /** True when this token is the lexicon word being taught. */
  vocab: boolean;
}

export type PartKind = 'bank' | 'joke' | 'vocab' | 'gen';

export interface PassagePart {
  id: string;
  kind: PartKind;
  text: string;
  start: number;
  end: number;
  vocab?: { entry: VocabEntry; context: number; isNew: boolean };
}

export interface Passage {
  text: string;
  tokens: Token[];
  parts: PassagePart[];
}

export interface RawPart {
  id: string;
  kind: PartKind;
  /** May contain {braces} around the lexicon word. */
  raw: string;
  vocab?: { entry: VocabEntry; context: number; isNew: boolean };
}

/** Strip {markup} and return the clean text plus the marked ranges. */
export function parseMarked(raw: string): { text: string; marks: Array<[number, number]> } {
  let text = '';
  const marks: Array<[number, number]> = [];
  let open = -1;
  for (const ch of raw) {
    if (ch === '{') open = text.length;
    else if (ch === '}') {
      if (open >= 0) marks.push([open, text.length]);
      open = -1;
    } else text += ch;
  }
  return { text, marks };
}

/** Join parts into one passage separated by single spaces, and tokenize it. */
export function buildPassage(parts: RawPart[]): Passage {
  let text = '';
  const outParts: PassagePart[] = [];
  const marks: Array<[number, number]> = [];
  parts.forEach((p, i) => {
    if (i > 0) text += ' ';
    const parsed = parseMarked(p.raw);
    const start = text.length;
    for (const [a, b] of parsed.marks) marks.push([start + a, start + b]);
    text += parsed.text;
    outParts.push({ id: p.id, kind: p.kind, text: parsed.text, start, end: text.length, vocab: p.vocab });
  });

  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const j = text.indexOf(' ', i);
    const end = j < 0 ? text.length : j;
    const part = Math.max(0, outParts.findIndex((p) => i >= p.start && i < p.end));
    const vocab = marks.some(([a, b]) => a < end && b > i);
    tokens.push({ text: text.slice(i, end), start: i, end, part, vocab });
    i = end + 1;
  }
  return { text, tokens, parts: outParts };
}

/**
 * Rough typing difficulty of a piece of text: length plus the "awkward" stuff
 * (punctuation, digits, capitals, rare letters). ~0.7 for short and plain,
 * ~2.5 for long sentences full of symbols.
 */
export function difficulty(text: string): number {
  let punct = 0;
  let digits = 0;
  let caps = 0;
  let rare = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (/[0-9]/.test(c)) digits++;
    else if (/[A-Z]/.test(c) && i > 0) caps++;
    else if (/[qxzjQXZJ]/.test(c)) rare++;
    else if (/[,;:'"?!()\-%/&]/.test(c)) punct++;
  }
  return text.length / 45 + punct * 0.1 + digits * 0.06 + caps * 0.05 + rare * 0.04;
}

/** Practice value of a text for the given key weights (higher = more of the keys you need). */
export function focusValue(text: string, weight: (key: string) => number, bigram?: (pair: string) => number): number {
  let sum = 0;
  let prev = '';
  for (const ch of text) {
    const k = keyOf(ch);
    sum += weight(k);
    if (bigram && prev) sum += bigram(prev + k) * 0.6;
    prev = k;
  }
  return sum / Math.sqrt(text.length + 4);
}
