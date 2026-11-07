/**
 * Procedural non-sequitur generator. Every slot is filled from a list, and the
 * choice is weighted toward options containing the keys the player needs to
 * practise, so "random" sentences quietly become targeted drills.
 */

const SUBJECTS = [
  'my left sock', 'the moon', 'a philosophical toaster', 'an anxious cactus', 'Grandma\'s robot',
  'the office printer', 'a retired pirate', 'the neighbor\'s goat', 'a very polite volcano', 'the last cookie',
  'an underpaid wizard', 'my calculator', 'a jazz-loving squid', 'the Wi-Fi router', 'a sleepy dragon',
  'the mayor of Pluto', 'a confused GPS', 'my houseplant', 'the quiet kazoo', 'a quantum hamster',
  'the vending machine', 'an extremely online owl', 'a jumbo jellyfish', 'a wax museum yak', 'the zebra next door',
  'a dozen quokkas', 'my evil twin, Kevin', 'the haunted fridge', 'a vegan vampire', 'an exhausted lighthouse',
];

/** [past tense, base form] */
const VERBS: Array<[string, string]> = [
  ['quietly invented', 'quietly invent'],
  ['refused to explain', 'refuse to explain'],
  ['accidentally adopted', 'accidentally adopt'],
  ['wrote a song about', 'write a song about'],
  ['filed a complaint against', 'file a complaint against'],
  ['fell in love with', 'fall in love with'],
  ['sold', 'sell'],
  ['borrowed', 'borrow'],
  ['politely ignored', 'politely ignore'],
  ['challenged', 'challenge'],
  ['rescued', 'rescue'],
  ['knitted a sweater for', 'knit a sweater for'],
  ['outsmarted', 'outsmart'],
  ['vacuumed', 'vacuum'],
  ['juggled', 'juggle'],
  ['zapped', 'zap'],
  ['quizzed', 'quiz'],
  ['haunted', 'haunt'],
  ['photobombed', 'photobomb'],
  ['became best friends with', 'become best friends with'],
  ['taxed', 'tax'],
  ['waxed poetic about', 'wax poetic about'],
];

const OBJECTS = [
  'a jar of pickles', 'the concept of Tuesday', 'seven rubber ducks', 'a suspicious sandwich', 'the entire ocean',
  'my homework', 'a box of jazz records', 'the speed of light', 'an inflatable kayak', 'twelve lazy walruses',
  'a vintage waffle iron', 'the Moon\'s spare keys', 'my last brain cell', 'a dozen quail eggs', 'an X-ray of a muffin',
  'an extra-large pizza', 'a velvet vest', 'the jury', 'a lost yo-yo', 'a frozen burrito', 'the quiz show host',
  'a puzzled zookeeper', 'my very expensive kazoo', 'the jukebox', 'a bucket of glitter',
];

const TAILS = [
  'at 3 a.m.', 'during the meeting', 'on Mars', 'without asking', 'for no reason', 'in a bathtub', 'while humming',
  'before breakfast', 'behind the fridge', 'in total silence', 'at the zoo', 'on live TV', 'with great confidence',
  'in 1999', 'under the full moon', 'every Wednesday', 'by accident', 'out of spite', 'with a kazoo',
];

const REACTIONS = [
  'Nobody was surprised.', 'Experts are baffled.', 'The cat approved.', 'Science has questions.', 'Mom is not amused.',
  'It went viral.', 'History will judge.', 'The jury is still out.', 'Classic Tuesday.', 'We don\'t talk about it.',
  'The goldfish saw everything.', 'Zero regrets.', 'Ask the yak.', 'Wow, just wow.',
];

const QUESTIONS = [
  'Who left the moon on?', 'Is soup a beverage?', 'Why is the ocean so damp?', 'Can a ghost catch a cold?',
  'Do clouds ever get lonely?', 'Where do lost socks go?', 'What if the fridge dreams?', 'How many yaks is too many?',
  'Who quizzed the quail?', 'Why is jazz so jazzy?', 'Is a waffle just a pancake with abs?', 'Who knew?',
];

const NUMBERS = ['2', '3', '7', '12', '42', '99', '1,000', '365'];

/** End a sentence with exactly one period ("at 3 a.m." already has one). */
const dot = (s: string): string => (s.endsWith('.') ? s : s + '.');
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const lowerFirst = (s: string): string => (s.startsWith('I ') || s.startsWith("I'") ? s : s.charAt(0).toLowerCase() + s.slice(1));

export type KeyWeights = (key: string) => number;

export class SentenceGenerator {
  constructor(private weights: KeyWeights, private rand: () => number = Math.random) {}

  /** Pick from a list, favouring entries that contain the keys being practised. */
  private pick<T>(list: readonly T[], text: (t: T) => string = (t) => String(t)): T {
    let total = 0;
    const scores = list.map((item) => {
      const s = text(item).toLowerCase();
      let w = 0;
      for (const ch of s) w += this.weights(ch);
      const score = 1 + (w / Math.sqrt(s.length + 1)) * 6;
      total += score;
      return score;
    });
    let r = this.rand() * total;
    for (let i = 0; i < list.length; i++) {
      r -= scores[i];
      if (r <= 0) return list[i];
    }
    return list[list.length - 1];
  }

  generate(): string {
    const subject = this.pick(SUBJECTS);
    const subject2 = this.pick(SUBJECTS.filter((s) => s !== subject));
    const [past, base] = this.pick(VERBS, (v) => v[0]);
    const obj = this.pick(OBJECTS);
    const tail = this.pick(TAILS);
    const reaction = this.pick(REACTIONS);
    const question = this.pick(QUESTIONS);
    const num = this.pick(NUMBERS);
    const templates = [
      () => `${cap(subject)} ${past} ${dot(obj + ' ' + tail)} ${reaction}`,
      () => `Breaking news: ${subject} ${past} ${obj}; ${lowerFirst(reaction)}`,
      () => `${cap(subject)} asked, "${question}" Nobody answered.`,
      () => `Note to self: never let ${subject} near ${dot(obj + ' ' + tail)}`,
      () => `${num} reasons why ${subject} ${past} ${obj}: none of them make sense.`,
      () => `If ${subject} ${past} ${obj}, then ${lowerFirst(question)}`,
      () => `Warning! ${cap(subject)} is about to ${base} ${obj}.`,
      () => `${cap(subject)} ${past} ${obj} (allegedly) ${dot(tail)}`,
      () => `Fun fact: ${subject} once ${past} ${obj} - ${lowerFirst(reaction)}`,
      () => `Dear diary, today ${subject} ${past} ${obj}. ${question}`,
      () => `Plot twist: ${subject} and ${subject2} ${past} ${obj} together.`,
      () => `"Don't ${base} ${obj}," said ${subject}, ${dot(tail)}`,
    ];
    return templates[Math.floor(this.rand() * templates.length)]();
  }
}
