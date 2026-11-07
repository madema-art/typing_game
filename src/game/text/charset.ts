/**
 * Characters KEYSTORM sentences may contain: everything on a standard US keyboard
 * that a typing game should practise, and nothing that needs dead keys or AltGr.
 */
export const ALLOWED = /^[A-Za-z0-9 .,;:'"?!()\-%/&]+$/;

export function isValidText(s: string): boolean {
  return ALLOWED.test(s) && !s.includes('  ') && s.trim() === s;
}

/** Characters typed with Shift on a US layout, mapped to the physical key. */
const SHIFTED: Record<string, string> = {
  '!': '1', '@': '2', '#': '3', $: '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
  _: '-', '+': '=', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/', '{': '[', '}': ']', '|': '\\', '~': '`',
};

/** The key a character is learned on: letters are case-folded, punctuation kept as-is. */
export function keyOf(ch: string): string {
  return /[A-Za-z]/.test(ch) ? ch.toLowerCase() : ch;
}

/** The physical key a character lives on (for the keyboard heatmap). */
export function physicalKey(ch: string): string {
  if (/[A-Za-z]/.test(ch)) return ch.toLowerCase();
  return SHIFTED[ch] ?? ch;
}

export function needsShift(ch: string): boolean {
  return /[A-Z]/.test(ch) || ch in SHIFTED;
}

/** Human label for a key in coach messages. */
export function keyLabel(k: string): string {
  if (k === ' ') return 'space';
  return `"${k}"`;
}
