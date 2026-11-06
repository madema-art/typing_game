import type { HighScore } from '../core/highscores';
import { CONFIG } from '../game/config';
import type { Game } from '../game/Game';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};

const SPEAKER_ON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5a5 5 0 0 1 0 7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
const SPEAKER_OFF =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l6 6M22 9l-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';

export type ScreenName = 'title' | 'playing' | 'paused' | 'gameover';

/**
 * A word typed to trigger a menu action ("start", "again"). Purely DOM.
 */
export class TypePrompt {
  private progress = 0;
  private spans: HTMLSpanElement[] = [];
  readonly word: string;

  constructor(private el: HTMLElement) {
    this.word = el.dataset.word ?? 'start';
    el.textContent = '';
    for (const ch of this.word) {
      const s = document.createElement('span');
      s.textContent = ch;
      el.appendChild(s);
      this.spans.push(s);
    }
    this.reset();
  }

  reset(): void {
    this.progress = 0;
    this.el.classList.remove('fire', 'error');
    this.paint();
  }

  /** Returns 'complete' when the whole word has been typed. */
  type(ch: string): 'ok' | 'error' | 'complete' {
    if (ch === this.word[this.progress]) {
      this.progress++;
      this.paint();
      if (this.progress >= this.word.length) {
        this.el.classList.add('fire');
        return 'complete';
      }
      return 'ok';
    }
    // Allow restarting the word without an explicit reset.
    this.progress = ch === this.word[0] ? 1 : 0;
    this.paint();
    this.el.classList.remove('error');
    void this.el.offsetWidth;
    this.el.classList.add('error');
    return 'error';
  }

  private paint(): void {
    this.spans.forEach((s, i) => {
      s.classList.toggle('done', i < this.progress);
      s.classList.toggle('next', i === this.progress);
    });
  }
}

/** All DOM-side presentation: screens, HUD, banner, buttons. */
export class UI {
  readonly titlePrompt = new TypePrompt($('title-word'));
  readonly overPrompt = new TypePrompt($('over-word'));

  private screens = {
    title: $('screen-title'),
    paused: $('screen-pause'),
    gameover: $('screen-over'),
  };
  private hud = $('hud');
  private hudBlocks = Array.from(document.querySelectorAll<HTMLElement>('.hud-block'));
  private hudScore = $('hud-score');
  private hudMult = $('hud-mult');
  private hudWave = $('hud-wave');
  private hudWaveBar = $('hud-wavebar');
  private hudWpm = $('hud-wpm');
  private hudAcc = $('hud-acc');
  private pips = $('hud-pips');
  private banner = $('banner');
  private bannerSub = $('banner-sub');
  private bannerMain = $('banner-main');
  private bannerDetail = $('banner-detail');
  private btnSound = $<HTMLButtonElement>('btn-sound');
  private btnPause = $<HTMLButtonElement>('btn-pause');
  private optSound = $<HTMLButtonElement>('opt-sound');
  private optMotion = $<HTMLButtonElement>('opt-motion');
  private pauseSound = $('pause-sound');
  private focusHint = $('focus-hint');

  private shownScore = 0;
  private last = { mult: 0, wave: -1, integrity: -1, wpm: '', acc: '', bar: '' };
  private wpmTimer = 0;

  constructor() {
    for (let i = 0; i < CONFIG.maxIntegrity; i++) this.pips.appendChild(document.createElement('i'));
    // Buttons must never steal keyboard focus (Space/Enter would "click" them).
    for (const b of document.querySelectorAll<HTMLButtonElement>('button')) {
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => b.blur());
    }
  }

  onSoundToggle(fn: () => void): void {
    this.btnSound.addEventListener('click', fn);
    this.optSound.addEventListener('click', fn);
  }
  onMotionToggle(fn: () => void): void {
    this.optMotion.addEventListener('click', fn);
  }
  onPauseClick(fn: () => void): void {
    this.btnPause.addEventListener('click', fn);
  }
  onPauseMenu(fn: (action: string) => void): void {
    for (const b of this.screens.paused.querySelectorAll<HTMLButtonElement>('[data-action]')) {
      b.addEventListener('click', () => fn(b.dataset.action!));
    }
  }

  show(screen: ScreenName): void {
    this.screens.title.classList.toggle('visible', screen === 'title');
    this.screens.paused.classList.toggle('visible', screen === 'paused');
    this.screens.gameover.classList.toggle('visible', screen === 'gameover');
    this.hud.classList.toggle('visible', screen === 'playing' || screen === 'paused');
    this.btnPause.classList.toggle('hidden', screen !== 'playing');
    if (screen === 'title') this.titlePrompt.reset();
    if (screen === 'gameover') this.overPrompt.reset();
    if (screen !== 'playing' && screen !== 'paused') this.hideBanner();
  }

  setFocusHint(on: boolean): void {
    this.focusHint.classList.toggle('visible', on);
  }

  setSound(muted: boolean): void {
    this.btnSound.innerHTML = muted ? SPEAKER_OFF : SPEAKER_ON;
    this.btnSound.classList.toggle('muted', muted);
    this.btnSound.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
    this.optSound.innerHTML = `Sound <b>${muted ? 'Off' : 'On'}</b>`;
    this.pauseSound.textContent = muted ? 'Sound off' : 'Sound on';
  }

  setMotion(mode: string, reduced: boolean): void {
    const label = mode === 'auto' ? `Auto (${reduced ? 'reduced' : 'full'})` : mode === 'reduced' ? 'Reduced' : 'Full';
    this.optMotion.innerHTML = `Motion <b>${label}</b>`;
    document.documentElement.classList.toggle('reduced-motion', reduced);
  }

  // ------------------------------------------------------------------ HUD

  resetHud(): void {
    this.shownScore = 0;
    this.last = { mult: 0, wave: -1, integrity: -1, wpm: '', acc: '', bar: '' };
    this.wpmTimer = 0;
  }

  /** Fade HUD blocks that would cover an enemy word: words always win. */
  private updateOcclusion(game: Game): void {
    // Read all rects before writing any classes to avoid layout thrashing.
    const rects = this.hudBlocks.map((b) => b.getBoundingClientRect());
    this.hudBlocks.forEach((block, i) => {
      const r = rects[i];
      let covered = false;
      for (const e of game.enemies) {
        if (e.state === 'dead') continue;
        const top = Math.min(e.py - e.r, e.ly);
        const bottom = e.ly + 40;
        const half = Math.max(e.labelW / 2, e.r) + 12;
        if (bottom > r.top - 8 && top < r.bottom + 8 && e.lx + half > r.left - 8 && e.lx - half < r.right + 8) {
          covered = true;
          break;
        }
      }
      if (block.classList.contains('occluded') !== covered) block.classList.toggle('occluded', covered);
    });
  }

  updateHud(game: Game, dt: number): void {
    const s = game.stats;
    this.updateOcclusion(game);
    // Rolling score counter.
    const diff = s.score - this.shownScore;
    if (diff !== 0) {
      this.shownScore += Math.abs(diff) < 2 ? diff : diff * Math.min(1, dt * 9);
      if (Math.abs(s.score - this.shownScore) < 1) this.shownScore = s.score;
      this.hudScore.textContent = Math.round(this.shownScore).toLocaleString('en-US');
    }

    const mult = s.multiplier;
    if (mult !== this.last.mult) {
      const up = mult > this.last.mult && this.last.mult !== 0;
      this.last.mult = mult;
      this.hudMult.className = `hud-mult m${mult}`;
      this.hudMult.firstElementChild!.textContent = `×${mult}`;
      if (up) {
        void this.hudMult.offsetWidth;
        this.hudMult.classList.add('bump');
      }
    }

    if (game.wave !== this.last.wave) {
      this.last.wave = game.wave;
      this.hudWave.textContent = String(game.wave);
    }
    const done = game.waveTotal ? 1 - game.waveRemaining / game.waveTotal : 0;
    const bar = `${Math.round(done * 100)}%`;
    if (bar !== this.last.bar) {
      this.last.bar = bar;
      this.hudWaveBar.style.width = bar;
    }

    this.wpmTimer -= dt;
    if (this.wpmTimer <= 0) {
      this.wpmTimer = 0.25;
      const wpm = s.wpm > 0 ? String(Math.round(s.wpm)) : '—';
      const acc = String(Math.round(s.accuracy * 100));
      if (wpm !== this.last.wpm) this.hudWpm.textContent = this.last.wpm = wpm;
      if (acc !== this.last.acc) this.hudAcc.textContent = this.last.acc = acc;
    }

    if (game.integrity !== this.last.integrity) {
      const hit = game.integrity < this.last.integrity && this.last.integrity !== -1;
      this.last.integrity = game.integrity;
      const ratio = game.integrity / CONFIG.maxIntegrity;
      this.pips.classList.toggle('warn', ratio <= 0.6 && ratio > 0.3);
      this.pips.classList.toggle('crit', ratio <= 0.3);
      Array.from(this.pips.children).forEach((p, i) => p.classList.toggle('off', i >= game.integrity));
      if (hit) {
        this.pips.classList.remove('hit');
        void this.pips.offsetWidth;
        this.pips.classList.add('hit');
      }
    }
  }

  // ------------------------------------------------------------------ banner

  showBanner(sub: string, main: string, detailHtml: string, kind: 'wave' | 'clear'): void {
    this.bannerSub.textContent = sub;
    this.bannerMain.textContent = main;
    this.bannerDetail.innerHTML = detailHtml;
    this.banner.classList.remove('show', 'clear');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    if (kind === 'clear') this.banner.classList.add('clear');
  }

  hideBanner(): void {
    this.banner.classList.remove('show', 'clear');
  }

  setBannerPaused(paused: boolean): void {
    this.banner.style.animationPlayState = paused ? 'paused' : 'running';
    this.bannerMain.style.animationPlayState = paused ? 'paused' : 'running';
  }

  // ------------------------------------------------------------------ screens

  setPauseStats(game: Game): void {
    const s = game.stats;
    $('pause-stats').innerHTML =
      `Wave <b>${game.wave}</b> · Score <b>${s.score.toLocaleString('en-US')}</b> · ` +
      `<b>${Math.round(s.wpm)}</b> WPM · <b>${Math.round(s.accuracy * 100)}%</b> accuracy`;
  }

  setGameOver(game: Game, rank: number, list: HighScore[]): void {
    const s = game.stats;
    $('over-score').textContent = s.score.toLocaleString('en-US');
    $('over-wpm').textContent = String(Math.round(s.wpm));
    $('over-acc').textContent = `${s.correct + s.errors === 0 ? 0 : Math.round(s.accuracy * 100)}%`;
    $('over-combo').textContent = String(s.maxCombo);
    $('over-wave').textContent = String(game.wave);
    $('over-kills').textContent = String(s.kills);
    $('over-best').classList.toggle('visible', rank === 0);
    this.renderScores($('over-scores'), list.slice(0, 5), rank);
  }

  renderScores(table: HTMLElement, list: HighScore[], highlight = -1): void {
    table.innerHTML = '';
    if (list.length === 0) {
      table.innerHTML = '<tr><td class="empty">No defenders yet — be the first</td></tr>';
      return;
    }
    list.forEach((e, i) => {
      const tr = document.createElement('tr');
      if (i === highlight) tr.className = 'latest';
      tr.innerHTML =
        `<td class="rank">${String(i + 1).padStart(2, '0')}</td>` +
        `<td class="score">${e.score.toLocaleString('en-US')}</td>` +
        `<td class="meta">W${e.wave}</td>` +
        `<td class="meta">${Math.round(e.wpm)} wpm</td>` +
        `<td class="meta">${Math.round(e.accuracy * 100)}%</td>`;
      table.appendChild(tr);
    });
  }

  renderTitleScores(list: HighScore[]): void {
    this.renderScores($('title-scores'), list.slice(0, 5));
  }
}
