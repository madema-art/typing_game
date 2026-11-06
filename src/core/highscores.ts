import { loadJSON, saveJSON } from './storage';

export interface HighScore {
  score: number;
  wave: number;
  wpm: number;
  accuracy: number;
  combo: number;
  date: string;
}

const KEY = 'keystorm.highscores.v1';
const MAX = 8;

export function loadHighScores(): HighScore[] {
  const list = loadJSON<HighScore[]>(KEY, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && typeof e.score === 'number' && Number.isFinite(e.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX);
}

/** Inserts the run and returns its rank (0-based) or -1 if it didn't make the table. */
export function submitHighScore(entry: HighScore): { rank: number; list: HighScore[] } {
  const list = loadHighScores();
  if (entry.score <= 0) return { rank: -1, list };
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  const trimmed = list.slice(0, MAX);
  const rank = trimmed.indexOf(entry);
  saveJSON(KEY, trimmed);
  return { rank, list: trimmed };
}
