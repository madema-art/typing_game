import type { Profile } from './profile';
import { keyLabel, keyOf } from './text/charset';

export type CoachTone = 'tip' | 'praise' | 'warn' | 'info';

export interface CoachMessage {
  text: string;
  tone: CoachTone;
}

interface Stroke {
  exp: string;
  typed: string;
  ok: boolean;
}

const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

/**
 * In-run typing intelligence. Watches the last few dozen keystrokes, notices
 * repeated mistakes and key confusions, puts those keys "in focus" (the
 * sentence picker then serves text full of them) and comments - with a
 * little attitude - on what it sees.
 */
export class Coach {
  /** Keys currently being drilled, with how many clean strokes they've had since. */
  readonly focus = new Map<string, { weight: number; run: number }>();
  private recent: Stroke[] = [];
  private lastMsgAt = -999;
  private keyMsgAt = new Map<string, number>();
  private pairMsgAt = new Map<string, number>();

  constructor(private profile: Profile) {}

  reset(): void {
    this.focus.clear();
    this.recent = [];
    this.lastMsgAt = -999;
    this.keyMsgAt.clear();
    this.pairMsgAt.clear();
  }

  /** How much the picker should want this key right now. */
  weight(key: string): number {
    const f = this.focus.get(key);
    return (f ? f.weight : 0) + this.profile.weakness(key) * 0.5;
  }

  focusKeys(): string[] {
    return [...this.focus.entries()].sort((a, b) => b[1].weight - a[1].weight).map(([k]) => k);
  }

  private can(now: number, gap = 7): boolean {
    return now - this.lastMsgAt >= gap;
  }

  private say(now: number, text: string, tone: CoachTone): CoachMessage {
    this.lastMsgAt = now;
    return { text, tone };
  }

  /** Opening line for a run, based on what we remember about the player. */
  welcome(now: number): CoachMessage {
    const p = this.profile;
    const day = p.data.day.streak;
    const weak = p.weakKeys(2);
    for (const k of weak) this.focus.set(k, { weight: 0.6, run: 0 });
    this.lastMsgAt = now;
    if (p.isNew) {
      return { text: 'Calibrating... type naturally. I\'m taking notes on every key.', tone: 'info' };
    }
    const streak = day > 1 ? `Day ${day} streak! ` : '';
    if (weak.length) {
      return { text: `${streak}Last time ${weak.map(keyLabel).join(' and ')} gave you trouble. They're on the menu.`, tone: 'info' };
    }
    const strong = p.strongKeys(1);
    return {
      text: `${streak}Welcome back. ${strong.length ? `Your ${keyLabel(strong[0])} is elite. ` : ''}Let's find something new to fix.`,
      tone: 'info',
    };
  }

  onKey(expected: string, typed: string, now: number): CoachMessage | null {
    const ok = expected === typed;
    const k = keyOf(expected);
    this.recent.push({ exp: k, typed: keyOf(typed), ok });
    if (this.recent.length > 50) this.recent.shift();

    if (ok) {
      const f = this.focus.get(k);
      if (f) {
        f.run++;
        if (f.run >= 8) {
          this.focus.delete(k);
          if (this.can(now, 5)) {
            return this.say(now, pick([
              `${keyLabel(k)} is behaving now. Nice work.`,
              `${keyLabel(k)}: tamed. Moving on.`,
              `Look at you, nailing ${keyLabel(k)} every time.`,
            ]), 'praise');
          }
        }
      }
      return null;
    }

    // A miss: is it a pattern?
    const f = this.focus.get(k);
    if (f) f.run = 0;
    const missesOnKey = this.recent.filter((s) => !s.ok && s.exp === k).length;
    const sameSlip = this.recent.filter((s) => !s.ok && s.exp === k && s.typed === keyOf(typed)).length;

    const keyQuiet = now - (this.keyMsgAt.get(k) ?? -999) > 40;
    if (sameSlip >= 2 && keyOf(typed) !== k && keyQuiet && now - (this.pairMsgAt.get(k + typed) ?? -999) > 60 && this.can(now)) {
      this.pairMsgAt.set(k + typed, now);
      this.keyMsgAt.set(k, now);
      this.focus.set(k, { weight: Math.max(1.2, f?.weight ?? 0), run: 0 });
      return this.say(now, pick([
        `You typed ${keyLabel(keyOf(typed))} for ${keyLabel(k)} again. Your fingers are gossiping.`,
        `Spotted it: ${keyLabel(keyOf(typed))} keeps sneaking in where ${keyLabel(k)} belongs. Practice incoming.`,
        `${keyLabel(k)} and ${keyLabel(keyOf(typed))} are neighbors, not twins. Drills on the way.`,
      ]), 'tip');
    }
    if (missesOnKey >= 3 && keyQuiet && this.can(now)) {
      this.keyMsgAt.set(k, now);
      this.focus.set(k, { weight: 1.2, run: 0 });
      return this.say(now, pick([
        `You and ${keyLabel(k)} need to talk. Sending reinforcements.`,
        `Third miss on ${keyLabel(k)}. The next sentences are full of it. You're welcome.`,
        `${keyLabel(k)} keeps dodging you. Practice round incoming.`,
      ]), 'tip');
    }
    if (missesOnKey >= 2 && !this.focus.has(k)) this.focus.set(k, { weight: 0.8, run: 0 });
    return null;
  }

  /** Pace adjustments the game made after a passage. */
  onPace(direction: 'harder' | 'easier', now: number): CoachMessage | null {
    if (!this.can(now, 5)) return null;
    return direction === 'harder'
      ? this.say(now, pick([
          'You\'re on fire. Tightening the formation.',
          'Too easy? Fine. Faster convoys inbound.',
          'Your fingers are warmed up. So is the storm.',
        ]), 'warn')
      : this.say(now, pick([
          'Easing off a little. Breathe; the shield believes in you.',
          'Slowing the convoys. Accuracy first, speed follows.',
          'Taking it down a notch. Smooth is fast.',
        ]), 'info');
  }

  onPerfectStreak(streak: number, now: number): CoachMessage | null {
    if (![3, 5, 10, 15, 20, 30].includes(streak)) return null;
    this.lastMsgAt = now;
    return { text: `${streak} perfect sentences in a row! ${streak >= 10 ? 'Legendary.' : 'Keep it going.'}`, tone: 'praise' };
  }

  onRecord(wpm: number, now: number): CoachMessage {
    this.lastMsgAt = now;
    return { text: `New personal best: ${wpm} WPM on that transmission!`, tone: 'praise' };
  }

  firstReading(wpm: number, now: number): CoachMessage {
    this.lastMsgAt = now;
    return { text: `Clocked you at ${wpm} WPM. Adjusting the storm to match.`, tone: 'info' };
  }
}
