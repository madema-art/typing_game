import { Sound } from './audio/Sound';
import { loadHighScores, submitHighScore } from './core/highscores';
import { Layout } from './core/layout';
import { SettingsStore } from './core/settings';
import { Game } from './game/Game';
import { Renderer } from './render/Renderer';
import { UI, type ScreenName } from './ui/UI';

/** Keys whose default browser behaviour (scrolling, find-in-page, focus moves, back navigation) we suppress. */
const SWALLOW = new Set([
  ' ', 'Spacebar', 'Backspace', 'Tab', 'Enter', 'Escape', "'", '/', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'PageUp', 'PageDown', 'Home', 'End',
]);

const WAVE_NOTES: Record<number, string> = {
  1: 'Type the words · protect the Spire',
  2: 'Heavy cruisers detected',
  3: 'Scout swarms inbound',
  5: 'The storm intensifies',
  8: 'Longer callsigns · faster hulls',
  12: 'Full assault',
};

/** Top-level controller: owns the loop, routes input, connects game events to audio and UI. */
export class App {
  private layout = new Layout();
  private settings = new SettingsStore();
  private sound = new Sound();
  private game = new Game(this.layout);
  private ui = new UI();
  private renderer: Renderer;
  private screen: ScreenName = 'title';
  private lastTime = 0;
  private overShownAt = 0;
  private resizeQueued = false;
  private redrawWhilePaused = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas, this.layout, this.game);
    this.renderer.resize();
    this.applySettings();
    this.settings.onChange(() => this.applySettings());
    this.wireGameEvents();
    this.wireDom();
    this.ui.renderTitleScores(loadHighScores());
    this.setScreen('title');
  }

  start(): void {
    requestAnimationFrame((t) => {
      this.lastTime = t;
      requestAnimationFrame(this.frame);
    });
  }

  /** Called once web fonts are ready so label widths are measured with the real font. */
  fontsReady(): void {
    this.renderer.measureFont();
  }

  // ------------------------------------------------------------------ loop

  private frame = (now: number): void => {
    // Clamp dt so a background tab or breakpoint never causes a huge simulation jump.
    const dt = Math.min(0.05, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;

    const paused = this.screen === 'paused';
    if (!paused) this.game.update(dt);
    // While paused the world is frozen behind a blurred overlay; skipping redraws keeps the blur cheap.
    if (!paused || this.redrawWhilePaused) {
      this.renderer.render(dt, paused);
      this.redrawWhilePaused = false;
    }
    if (this.screen === 'playing' || this.screen === 'paused') this.ui.updateHud(this.game, dt);

    if (this.screen === 'playing' && this.game.phase === 'over') this.showGameOver();

    requestAnimationFrame(this.frame);
  };

  // ------------------------------------------------------------------ state changes

  private setScreen(s: ScreenName): void {
    this.screen = s;
    this.ui.show(s);
    this.ui.setBannerPaused(s === 'paused');
    this.sound.suspendAmbience(s === 'paused');
    this.ui.setFocusHint(s === 'title' && !document.hasFocus());
  }

  private startGame(): void {
    this.renderer.particles.clear();
    this.ui.resetHud();
    this.game.start();
    this.setScreen('playing');
  }

  private pause(): void {
    if (this.screen !== 'playing' || this.game.phase !== 'playing') return;
    this.ui.setPauseStats(this.game);
    this.setScreen('paused');
  }

  private resume(): void {
    if (this.screen !== 'paused') return;
    this.lastTime = performance.now();
    this.setScreen('playing');
  }

  private toTitle(): void {
    this.game.toIdle();
    this.renderer.particles.clear();
    this.ui.renderTitleScores(loadHighScores());
    this.setScreen('title');
  }

  private showGameOver(): void {
    const s = this.game.stats;
    const { rank, list } = submitHighScore({
      score: s.score,
      wave: this.game.wave,
      wpm: Math.round(s.wpm),
      accuracy: s.accuracy,
      combo: s.maxCombo,
      date: new Date().toISOString(),
    });
    this.ui.setGameOver(this.game, rank, list);
    this.overShownAt = performance.now();
    this.setScreen('gameover');
  }

  private toggleMute(): void {
    this.sound.unlock();
    this.settings.set('muted', !this.settings.data.muted);
    this.sound.ui();
  }

  private cycleMotion(): void {
    const order = ['auto', 'full', 'reduced'] as const;
    const i = order.indexOf(this.settings.data.motion);
    this.settings.set('motion', order[(i + 1) % order.length]);
  }

  private applySettings(): void {
    const muted = this.settings.data.muted;
    this.sound.setMuted(muted);
    this.ui.setSound(muted);
    const reduced = this.settings.reducedMotion;
    this.renderer.setReducedMotion(reduced);
    this.ui.setMotion(this.settings.data.motion, reduced);
  }

  // ------------------------------------------------------------------ wiring

  private wireGameEvents(): void {
    const ev = this.game.events;
    const snd = this.sound;
    ev.on('shot', ({ index, final }) => snd.shot(index, this.game.stats.multiplier, final));
    ev.on('lock', () => snd.lock());
    ev.on('miss', () => snd.miss());
    ev.on('hit', () => snd.hit());
    ev.on('kill', ({ enemy }) => snd.explode(enemy.def.kind));
    ev.on('baseHit', () => snd.baseHit());
    ev.on('comboBreak', () => snd.comboBreak());
    ev.on('multiplierUp', ({ multiplier }) => snd.multiplierUp(multiplier));
    ev.on('gameOver', () => snd.gameOver());
    ev.on('waveStart', ({ wave }) => {
      snd.waveStart();
      const note = WAVE_NOTES[wave] ?? `${this.game.waveTotal} hostiles inbound`;
      this.ui.showBanner('Incoming', `Wave ${wave}`, note, 'wave');
    });
    ev.on('waveClear', ({ wave, bonus, flawless, perfect, repaired }) => {
      snd.waveClear();
      if (repaired) snd.repair();
      const tags: string[] = [];
      if (flawless) tags.push('<span class="green">Flawless</span>');
      if (perfect) tags.push('<span class="gold">Perfect accuracy</span>');
      const detail = `+${bonus.toLocaleString('en-US')} bonus${tags.length ? ' · ' + tags.join(' · ') : ''}`;
      this.ui.showBanner(`Wave ${wave}`, 'Cleared', detail, 'clear');
    });
    this.renderer.bg.onThunder = (i) => {
      if (this.screen === 'playing' || this.screen === 'title') snd.thunder(i);
    };
  }

  private wireDom(): void {
    window.addEventListener('keydown', this.onKeyDown, { capture: true });
    window.addEventListener('resize', () => {
      if (this.resizeQueued) return;
      this.resizeQueued = true;
      requestAnimationFrame(() => {
        this.resizeQueued = false;
        this.renderer.resize();
        this.redrawWhilePaused = true;
      });
    });
    window.addEventListener('blur', () => {
      this.pause();
      this.ui.setFocusHint(this.screen === 'title');
    });
    window.addEventListener('focus', () => this.ui.setFocusHint(false));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });
    // Any click counts as a user gesture for audio and refocuses the page.
    window.addEventListener('pointerdown', () => {
      this.sound.unlock();
      this.ui.setFocusHint(false);
    });

    this.ui.onSoundToggle(() => this.toggleMute());
    this.ui.onMotionToggle(() => this.cycleMotion());
    this.ui.onPauseClick(() => this.pause());
    this.ui.onPauseMenu((a) => this.pauseAction(a));
    document.getElementById('title-word')?.addEventListener('click', () => {
      this.sound.unlock();
      this.sound.uiConfirm();
      this.startGame();
    });
  }

  private pauseAction(action: string): void {
    switch (action) {
      case 'resume':
        this.resume();
        break;
      case 'restart':
        this.startGame();
        break;
      case 'quit':
        this.toTitle();
        break;
      case 'sound':
        this.toggleMute();
        break;
    }
  }

  /** Normalise a keyboard event to a lowercase a-z letter, or null. */
  private letterOf(e: KeyboardEvent): string | null {
    if (e.key.length === 1) {
      const k = e.key.toLowerCase();
      if (k >= 'a' && k <= 'z') return k;
    }
    // Non-Latin layouts: fall back to the physical key.
    if (e.key.length === 1 && /^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
    return null;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    // Leave browser/OS shortcuts alone (Ctrl+R, Alt+Tab, F5, F11, F12 ...).
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^F\d{1,2}$/.test(e.key)) return;

    const letter = this.letterOf(e);
    if (letter || SWALLOW.has(e.key)) e.preventDefault();
    if (e.isComposing || e.key === 'Dead') return;

    this.sound.unlock();
    this.ui.setFocusHint(false);

    switch (this.screen) {
      case 'title':
        if (e.repeat) return;
        if (e.key === 'Enter' || e.key === ' ') {
          this.sound.uiConfirm();
          this.startGame();
        } else if (letter) {
          const r = this.ui.titlePrompt.type(letter);
          if (r === 'complete') {
            this.sound.uiConfirm();
            window.setTimeout(() => this.screen === 'title' && this.startGame(), 180);
          } else if (r === 'ok') this.sound.ui();
          else this.sound.miss();
        }
        break;

      case 'playing':
        if (e.key === 'Escape') {
          if (!e.repeat) this.pause();
        } else if (e.key === 'Backspace') {
          this.game.release();
        } else if (letter && !e.repeat) {
          this.game.type(letter);
        }
        break;

      case 'paused':
        if (e.repeat) return;
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') this.resume();
        else if (letter === 'r') this.startGame();
        else if (letter === 'q') this.toTitle();
        else if (letter === 'm') this.toggleMute();
        break;

      case 'gameover': {
        // Brief grace period so frantic typing at the moment of death doesn't skip the results.
        if (e.repeat || performance.now() - this.overShownAt < 900) return;
        if (e.key === 'Enter' || e.key === ' ') {
          this.sound.uiConfirm();
          this.startGame();
        } else if (e.key === 'Escape') {
          this.toTitle();
        } else if (letter) {
          const r = this.ui.overPrompt.type(letter);
          if (r === 'complete') {
            this.sound.uiConfirm();
            window.setTimeout(() => this.screen === 'gameover' && this.startGame(), 180);
          } else if (r === 'ok') this.sound.ui();
          else this.sound.miss();
        }
        break;
      }
    }
  };
}
