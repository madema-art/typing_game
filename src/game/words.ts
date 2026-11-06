/**
 * Curated word bank. Lowercase a-z only, family friendly, themed loosely
 * around space, weather, technology and nature. Words are bucketed by length
 * at load time so the picker can request any length range.
 */
const RAW = `
arc ash bay bit box cap cog cue dew dot elm era fin fog fox fur gem gap hex hub hue ice ink ion ivy
jet jam jaw key kit lab lid map mix net nod oak orb owl ore pod ray rim rod rye sky sun tan tin tip
toy urn van vat wax web yak yam zap zen zip zoo elk emu fig gum hop hut kin log mud nut pen pie
atom axis beam bell bolt byte calm code core dawn deck disk dock dune dust echo edge film fire flux
foam fuel gale gate gear glow grid gust halo haze helm hull iris iron jade jump kite knot lake lamp
lava leaf link loop lynx mesa mint mist moon nova oath omen onyx opal orca path peak pine plum port
quiz quip quad rain reef ring rust sail sand scan silk snow star surf tide tusk unit undo vale vent
volt wave wind wing wolf yarn yeti yolk yoga zinc zone zest jolt jazz void vast arch bark cave cove
dart drum fern flag fork frog glue harp hawk hive idea inch isle kelp kiwi lime lion mars mule
nest note pace pear raft rope ruby sage seal ship silo sled soap spin swan task tent tuba twig vine
warp wick yawn zoom
amber anchor arcade archer aurora beacon binary blaze breeze bridge cactus candle canyon carbon
castle cipher cobalt comet copper coral cosmos cradle crater crystal cyclone delta desert dragon
drift drone eclipse ember engine falcon fathom flare forest fusion galaxy garnet glacier gravity
harbor helix horizon island ivory jasper jungle kernel kettle lantern laser lunar magnet marble
meadow meteor mirror nebula needle nectar nimbus ocean octave oracle orbit oxygen pebble photon
pilot pixel planet plasma prism pulsar pulse quartz quasar quest quiver radar radius raven reactor
ripple rocket signal silver socket solar sonar spark sphere spiral static summit tempest thunder
timber tundra turbo vapor vector velvet violet vortex walnut warden willow winter wizard xenon
xylem yonder zenith zephyr zigzag cascade voltage current circuit compass capsule cluster glimmer
harvest lagoon magma mantis marlin matrix mosaic nomad panther phantom rapids rhythm shadow
shuttle storm sunset tornado trident triton typhoon umbra unicorn utopia valley venture viking
whisper zodiac acorn bamboo banjo basil biscuit blossom bonfire boulder cabin camera caravan
cedar cherry chorus citrus clover dolphin domino emerald feather fiddle galleon
gecko ginger goblet granite gusto hammock hazel igloo indigo jaguar jigsaw juniper kayak kiosk
koala lemon locket lotus mango maple marina melody mustang nickel noodle nutmeg olive orchid otter
paddle parrot pepper pianist poppy puzzle quokka quilt rainbow reindeer saddle salmon sapphire
sequoia sherpa skater spruce squash tango teapot thistle tiger toucan trumpet tulip turtle
ukulele umpire uplink upward vellum velcro vessel vista waffle walrus whistle yodel yellow zebra
zither ultra umber
afterglow alchemist algorithm amplifier andromeda antimatter asteroid astronaut atmosphere
avalanche barricade blueprint boomerang butterfly calibrate cartridge catalyst celestial chameleon
chronicle clockwork commander constellation continuum coordinate crescendo cyberspace dandelion
daybreak deflector dimension discovery dragonfly earthquake electron elevation encounter equinox
equator expedition firewall firework flagship frequency frontier generator geometry graviton
guardian hailstorm harmonica hemisphere hurricane hyperdrive hyperspace illuminate infinity
interceptor ironclad jellyfish juggernaut kaleidoscope keyboard labyrinth lighthouse lightning
longitude magnitude mainframe marathon maverick meridian microchip midnight millennium monolith
moonlight mountain navigator neutrino nightfall northern observatory obsidian overdrive overture
paradigm parallax particle pathfinder perimeter phosphor pinnacle platinum porcupine propeller
prototype quadrant quicksilver radiance rainstorm reflector rendezvous resonance satellite sentinel
shockwave silhouette skyscraper snowflake solstice spaceport spectrum starlight stargazer
stratosphere submarine sunflower supernova symphony telescope terminal thunderbolt trajectory
tranquil turbulence twilight typewriter ultraviolet underground universe vanguard velocity vigilant
waterfall wavelength whirlwind wilderness windmill wireless wonderland workshop xylophone yesterday
zeppelin aquamarine backpacker bluebird campfire cornerstone driftwood evergreen fireflies
gemstone gingerbread grasshopper honeycomb hummingbird inventor kingfisher lemonade marshmallow
moonbeam nightingale orchestra peppermint quarterback raspberry sandcastle seashell snowstorm
stardust storyteller sunshine tapestry thunderstorm treasure undertow upstream vineyard
watermelon woodland yachtsman zookeeper
`;

const WORDS: string[] = Array.from(
  new Set(
    RAW.split(/\s+/)
      .map((w) => w.trim().toLowerCase())
      .filter((w) => /^[a-z]+$/.test(w)),
  ),
);

const byLength = new Map<number, string[]>();
for (const w of WORDS) {
  const list = byLength.get(w.length) ?? [];
  list.push(w);
  byLength.set(w.length, list);
}

export const WORD_COUNT = WORDS.length;

/**
 * Picks words with no immediate repetition and, where possible, a starting
 * letter that no living enemy currently shares (avoids target ambiguity).
 */
export class WordPicker {
  private recent: string[] = [];
  private recentSet = new Set<string>();
  private readonly memory = 60;

  reset(): void {
    this.recent = [];
    this.recentSet.clear();
  }

  pick(minLen: number, maxLen: number, avoidLetters: Set<string>): string {
    const pool: string[] = [];
    for (let len = minLen; len <= maxLen; len++) {
      const list = byLength.get(len);
      if (list) pool.push(...list);
    }
    if (pool.length === 0) pool.push(...WORDS);

    // Relax constraints progressively so we always return something.
    const tiers: Array<(w: string) => boolean> = [
      (w) => !this.recentSet.has(w) && !avoidLetters.has(w[0]),
      (w) => !avoidLetters.has(w[0]) && !this.isLast(w),
      (w) => !this.recentSet.has(w),
      (w) => !this.isLast(w),
    ];
    let chosen: string | undefined;
    for (const ok of tiers) {
      const candidates = pool.filter(ok);
      if (candidates.length) {
        chosen = candidates[Math.floor(Math.random() * candidates.length)];
        break;
      }
    }
    chosen ??= pool[Math.floor(Math.random() * pool.length)];
    this.remember(chosen);
    return chosen;
  }

  /** Forget the most recent pick (used when a spawn is postponed). */
  unpickLast(): void {
    const w = this.recent.pop();
    if (w && !this.recent.includes(w)) this.recentSet.delete(w);
  }

  private isLast(w: string): boolean {
    return this.recent.length > 0 && this.recent[this.recent.length - 1] === w;
  }

  private remember(w: string): void {
    this.recent.push(w);
    this.recentSet.add(w);
    while (this.recent.length > this.memory) {
      const old = this.recent.shift()!;
      if (!this.recent.includes(old)) this.recentSet.delete(old);
    }
  }
}
