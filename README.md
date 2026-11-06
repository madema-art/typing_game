# KEYSTORM

An arcade survival typing game. Enemy ships descend on the Spire, your planetary defence turret. Every ship carries a word. Type it to lock on and fire one laser bolt per correct letter. Finish the word to destroy the ship. If a ship reaches the shield, the shield takes damage. When the shield fails, the run ends.

Built with Vite, TypeScript, Canvas 2D, CSS and Web Audio. It has no runtime services and no external assets: sound is synthesized, ships are drawn in code, and the fonts are bundled locally.

## Run it (Windows)

1. Install **Node.js 22 LTS** (or any version ≥ 20.19) from https://nodejs.org.
2. Open **PowerShell** or **Command Prompt** in this folder.
3. Run:

   ```bash
   npm install
   ```

   ```bash
   npm run dev
   ```

4. Your browser opens at http://localhost:5173. If it doesn't, open that address yourself.

For an optimized build:

```bash
npm run build
```

```bash
npm run preview
```

## Controls

| Key | Action |
| --- | --- |
| **A–Z** | Type a ship's word. The first letter locks onto the matching ship nearest the shield, and each correct letter fires |
| **Backspace** | Release the current lock. Letters you already typed on that ship stay typed |
| **Esc** | Pause or resume. The game also pauses when the window loses focus |
| **Enter** / type `start` | Start from the title screen |
| **Enter** / type `again` | Restart from the game-over screen (**Esc** returns to the title) |
| **R / M / Q** while paused | Restart, mute or unmute, quit to the title |

The speaker button in the bottom-right corner mutes sound at any time. The title screen also has a **Motion** option: *Auto* follows your OS reduced-motion setting, and you can also choose *Full* or *Reduced*.

## How it plays

- **Scouts** (amber) are fast and fragile, with short words. From wave 3 they sometimes arrive in swarms.
- **Fighters** (pink) move at standard speed and carry medium-length words.
- **Heavies** (violet) are slow and armoured, carry long words, and do 3 damage if they get through.
- A wrong letter doesn't change the word. It breaks your combo and lowers your accuracy.
- **Combo → multiplier:** ×2 at 10 correct letters in a row, ×3 at 25, ×4 at 50 and ×5 at 80.
- Clearing a wave earns a bonus. A *Flawless* wave (no shield damage) also repairs one shield segment, and *Perfect accuracy* earns extra points.
- **WPM** is (correct characters ÷ 5) ÷ active typing minutes. Active time starts at your first keystroke and only counts while ships are on screen. Pauses, menus and wave breaks don't count.
- Your 8 best runs are saved in your browser's `localStorage`.

## Project layout

```
src/
  main.ts            entry: fonts, styles, app bootstrap
  App.ts             loop, screen state machine, keyboard routing, event → audio/UI wiring
  game/
    Game.ts          simulation: spawning, targeting, typing, bolts, damage, waves, game over
    director.ts      difficulty curve per wave
    enemyTypes.ts    scout / fighter / heavy definitions
    words.ts         curated word bank + picker (no repeats, distinct first letters)
    stats.ts         score, combo, multiplier, WPM, accuracy
    config.ts        tuning constants
    entities.ts      Enemy / Bolt / Turret types
  render/
    Renderer.ts      world drawing + effects (shake, flashes, ripples)
    Background.ts    nebula, starfield, lightning, planet
    Particles.ts     pooled particles + floating score text
    sprites.ts       pre-rendered ship and glow sprites
  audio/Sound.ts     procedural Web Audio sound effects
  ui/UI.ts           DOM HUD, banners, title / pause / game-over screens
  core/              layout, math, events, settings, storage, high scores
```

Gameplay code never touches the DOM or audio. `Game` emits typed events (`shot`, `kill`, `miss`, `baseHit`, `waveClear`, …), and the renderer, sound and UI subscribe to them. That keeps new features (enemy types, power-ups, modes) self-contained.
