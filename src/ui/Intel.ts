import type { CoachMessage } from '../game/coach';
import type { Game } from '../game/Game';
import type { Profile, VocabState } from '../game/profile';
import { keyLabel, keyOf, physicalKey } from '../game/text/charset';
import { LEXICON, type VocabEntry } from '../game/text/vocab';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const KEY_ROWS = [
  ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'"],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/'],
  [' '],
];

function stars(state: VocabState | undefined): string {
  const box = state?.box ?? 0;
  return '★'.repeat(Math.min(5, box)) + '☆'.repeat(Math.max(0, 5 - box));
}

/**
 * The typing-intelligence side of the interface: transmission bar, coach
 * remarks, lexicon cards, keyboard heatmap and insights.
 */
export class Intel {
  private tx = $('transmission');
  private txText = $('tx-text');
  private txLabel = $('tx-label');
  private txCount = $('tx-count');
  private caps = $('caps-warning');
  private coachEl = $('coach');
  private coachText = $('coach-text');
  private card = $('vocab-card');
  private spans: HTMLSpanElement[] = [];
  private lastRev = -1;
  private lastCursor = -1;
  private coachTimer: number | undefined;
  private cardTimer: number | undefined;
  private queue: CoachMessage[] = [];
  private coachBusyUntil = 0;

  // ------------------------------------------------------------------ transmission bar

  /** Rebuild or refresh the transmission text when the game state changed. */
  update(game: Game): void {
    if (game.revision === this.lastRev) return;
    this.lastRev = game.revision;
    const p = game.passage;
    if (!p) {
      this.tx.classList.add('idle');
      if (game.phase !== 'playing') this.setIdleText('');
      return;
    }
    this.tx.classList.remove('idle', 'complete');
    if (this.spans.length !== p.text.length || this.txText.dataset.text !== p.text) {
      this.txText.textContent = '';
      this.txText.dataset.text = p.text;
      this.spans = [];
      const frag = document.createDocumentFragment();
      for (const ch of p.text) {
        const s = document.createElement('span');
        s.textContent = ch;
        frag.appendChild(s);
        this.spans.push(s);
      }
      this.txText.appendChild(frag);
      const parts = p.parts.length;
      const vocab = p.parts.find((x) => x.vocab);
      this.txLabel.textContent = vocab ? 'Incoming transmission · lexicon' : parts > 1 ? `Incoming transmission · ${parts} sentences` : 'Incoming transmission';
    }
    const vocabRanges = p.tokens.filter((t) => t.vocab);
    const missRanges = [...game.crashed].map((i) => p.tokens[i]).filter(Boolean);
    for (let i = 0; i < this.spans.length; i++) {
      const s = this.spans[i];
      let cls = i < game.cursor ? 'done' : '';
      if (i === game.cursor) cls = 'cur';
      if (vocabRanges.some((t) => i >= t.start && i < t.end)) cls += ' vocab';
      if (missRanges.some((t) => i >= t.start && i < t.end)) cls = 'miss';
      if (s.className !== cls) s.className = cls;
    }
    this.lastCursor = game.cursor;
  }

  /** Flash the current character red after a mistake. */
  flashError(): void {
    const s = this.spans[this.lastCursor];
    if (!s) return;
    s.classList.remove('err');
    void s.offsetWidth;
    s.classList.add('err');
  }

  setIdleText(text: string): void {
    this.spans = [];
    this.txText.dataset.text = '';
    this.txText.textContent = text;
    this.txLabel.textContent = 'Incoming transmission';
  }

  setCount(index: number, total: number): void {
    this.txCount.textContent = total ? `${index} / ${total}` : '';
  }

  complete(): void {
    this.tx.classList.add('complete');
  }

  setCaps(on: boolean): void {
    this.caps.classList.toggle('visible', on);
  }

  /** Bottom edge of the transmission bar in px (ships materialize just below it). */
  bandBottom(): number {
    const r = this.tx.getBoundingClientRect();
    return r.height > 0 ? r.bottom : 120;
  }

  // ------------------------------------------------------------------ coach

  coach(msg: CoachMessage): void {
    const now = performance.now();
    if (now < this.coachBusyUntil) {
      if (this.queue.length < 2) this.queue.push(msg);
      return;
    }
    this.showCoach(msg);
  }

  private showCoach(msg: CoachMessage): void {
    this.coachEl.className = `coach visible ${msg.tone}`;
    this.coachText.textContent = msg.text;
    const ms = Math.min(6500, 2600 + msg.text.length * 45);
    this.coachBusyUntil = performance.now() + Math.min(ms, 2600);
    window.clearTimeout(this.coachTimer);
    this.coachTimer = window.setTimeout(() => {
      this.coachEl.classList.remove('visible');
      const next = this.queue.shift();
      if (next) window.setTimeout(() => this.showCoach(next), 350);
    }, ms);
  }

  clearCoach(): void {
    this.queue = [];
    window.clearTimeout(this.coachTimer);
    this.coachEl.classList.remove('visible');
  }

  // ------------------------------------------------------------------ lexicon card

  vocab(entry: VocabEntry, isNew: boolean, clean: boolean, state: VocabState, profile: Profile): void {
    $('vocab-kicker').textContent = isNew ? 'New word unlocked' : state.box >= 4 ? 'Mastered' : 'Review';
    $('vocab-word').textContent = entry.word;
    $('vocab-pos').textContent = entry.pos;
    $('vocab-def').textContent = entry.def;
    $('vocab-meta').innerHTML =
      `<span class="stars">${stars(state)}</span> · ` +
      (clean ? 'typed perfectly' : 'keep practising') +
      ` · lexicon ${profile.vocabCollected}/${LEXICON.length}`;
    this.card.classList.add('visible');
    window.clearTimeout(this.cardTimer);
    this.cardTimer = window.setTimeout(() => this.card.classList.remove('visible'), 7000);
  }

  hideCard(): void {
    window.clearTimeout(this.cardTimer);
    this.card.classList.remove('visible');
  }

  // ------------------------------------------------------------------ title

  renderTitleStats(profile: Profile): void {
    const d = profile.data;
    const bits: string[] = [];
    if (d.day.streak > 0) bits.push(`<span class="gold"><b>${d.day.streak}</b>day streak</span>`);
    if (d.records.bestWpm > 0) bits.push(`<span><b>${d.records.bestWpm}</b>best wpm</span>`);
    if (d.records.bestPerfectStreak > 0) bits.push(`<span><b>${d.records.bestPerfectStreak}</b>best perfect streak</span>`);
    bits.push(`<span class="gold"><b>${profile.vocabCollected}/${LEXICON.length}</b>words collected</span>`);
    const weak = profile.weakKeys(3);
    if (weak.length) bits.push(`<span>focus keys <code>${weak.map((k) => esc(keyLabel(k))).join(' ')}</code></span>`);
    $('title-stats').innerHTML = bits.join('');
    $('opt-lexicon').innerHTML = `Lexicon <b>${profile.vocabCollected}/${LEXICON.length}</b>`;
  }

  // ------------------------------------------------------------------ lexicon screen

  renderLexicon(profile: Profile): void {
    const collected = profile.vocabCollected;
    $('lexicon-sub').textContent = `${collected} of ${LEXICON.length} words collected · ${profile.vocabMastered} mastered · type them in battle to level them up`;
    const items = [...LEXICON].sort((a, b) => {
      const sa = profile.vocabState(a.word);
      const sb = profile.vocabState(b.word);
      if (!!sa !== !!sb) return sa ? -1 : 1;
      return a.word.localeCompare(b.word);
    });
    $('lexicon-grid').innerHTML = items
      .map((e) => {
        const st = profile.vocabState(e.word);
        if (!st) return `<div class="lex-item locked"><div class="lex-word">${'?'.repeat(Math.min(10, e.word.length))}</div><div class="lex-def">Not discovered yet</div></div>`;
        return `<div class="lex-item"><span class="lex-stars">${stars(st)}</span><div class="lex-word">${esc(e.word)} <em>${esc(e.pos)}</em></div><div class="lex-def">${esc(e.def)}</div></div>`;
      })
      .join('');
  }

  // ------------------------------------------------------------------ game over intel

  renderIntel(game: Game): void {
    const profile = game.profile;
    // Keyboard heatmap: aggregate every character onto the physical key it lives on.
    const agg = new Map<string, { n: number; w: number }>();
    for (const [k, st] of Object.entries(profile.data.keys)) {
      const pk = physicalKey(k);
      const a = agg.get(pk) ?? { n: 0, w: 0 };
      a.w += profile.weakness(k) * st.n;
      a.n += st.n;
      agg.set(pk, a);
    }
    $('over-keyboard').innerHTML = KEY_ROWS.map(
      (row) =>
        `<div class="kb-row">${row
          .map((k) => {
            const a = agg.get(k);
            const label = k === ' ' ? 'space' : esc(k);
            if (!a || a.n < 3) return `<span class="kb-key${k === ' ' ? ' space' : ''}">${label}</span>`;
            const w = a.w / a.n;
            const color = w < 0.3 ? '#5ff6c8' : w < 0.6 ? '#c8f06a' : w < 0.9 ? '#ffb547' : '#ff4d6d';
            const st = profile.data.keys[keyOf(k)];
            const title = st ? `${Math.round((1 - st.err / st.n) * 100)}% accurate over ${st.n} presses` : '';
            return `<span class="kb-key has${k === ' ' ? ' space' : ''}" style="background:${color}" title="${esc(title)}">${label}</span>`;
          })
          .join('')}</div>`,
    ).join('');

    const s = game.stats;
    const notes: string[] = [];
    const weak = profile.weakKeys(3);
    if (weak.length) notes.push(`Needs work: <b>${weak.map(keyLabel).map(esc).join(', ')}</b>. Expect to see more of them.`);
    const slip = profile.topConfusions(1)[0];
    if (slip) notes.push(`Most common slip: <b>${esc(keyLabel(slip.typed))}</b> instead of <b>${esc(keyLabel(slip.expected))}</b> (${slip.count}×).`);
    const strong = profile.strongKeys(3);
    if (strong.length) notes.push(`Strengths: <b>${strong.map(keyLabel).map(esc).join(', ')}</b>.`);
    notes.push(`This run: <b>${Math.round(s.wpm)} WPM</b> · your average: <b>${Math.round(profile.wpm)} WPM</b>.`);
    notes.push(`Perfect sentences: <b>${s.perfectSentences}</b> of ${s.sentences} · best streak <b>${s.bestPerfectStreak}</b> (all-time ${profile.data.records.bestPerfectStreak}).`);
    if (profile.data.day.streak > 0) notes.push(`Daily streak: <b>${profile.data.day.streak} day${profile.data.day.streak === 1 ? '' : 's'}</b> · come back tomorrow to keep it.`);
    if (s.vocab.length) {
      const words = s.vocab
        .slice(-4)
        .map((w) => LEXICON.find((e) => e.word === w))
        .filter((e): e is VocabEntry => !!e)
        .map((e) => `<span class="gold">${esc(e.word)}</span> (${esc(e.def)})`);
      notes.push(`Words met: ${words.join('; ')}.`);
    }
    $('over-insights').innerHTML = notes.map((n) => `<li>${n}</li>`).join('');
  }
}
