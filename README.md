# KEYSTORM

An arcade survival typing game. Enemy ships descend on the Spire, your planetary defence turret. Every ship carries a word. Type it to lock on and fire one laser bolt per correct letter. Finish the word to destroy the ship. If a ship reaches the shield, the shield takes damage. When the shield fails, the run ends.

Built with Vite, TypeScript, Canvas 2D, CSS and Web Audio. It has no runtime services and no external assets: the music and sound are synthesized live, ships are drawn in code, and the fonts are bundled locally.

### Sound

The soundtrack is generated as you play: a synthwave loop in A minor with pads, arpeggios, bass and drums. It builds as the waves get harder, adds a lead melody in Overdrive, sounds a warning when the shield is low, and goes muffled while paused. Your lasers are tuned to the chord playing at that moment, so typing a word plays a short melody that fits the music. Effects are panned to where they happen on screen and pass through a generated reverb and an echo.

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

## Desktop shortcut (Windows)

Want KEYSTORM on your desktop like a regular game? From this folder, double-click **`Install-Keystorm.cmd`**.

The installer does the following, without needing admin rights:

1. Checks that Node.js 22+ is installed.
2. Installs to `%LOCALAPPDATA%\Keystorm` and builds **`KEYSTORM.exe`**, a small launcher with the KEYSTORM icon. It's compiled on your PC by the C# compiler that ships with Windows.
3. Downloads and builds the latest version of the game from GitHub.
4. Adds **KEYSTORM** shortcuts to your Desktop and Start menu.

Each time you open the shortcut, a splash screen appears and the launcher:

- **checks GitHub for a newer version.** If there is one, it downloads and builds it before starting, and shows the progress on the splash. A failed update leaves the installed version working.
- **plays the installed version if you're offline.**
- **opens the game in its own window** using Edge or Chrome in app mode, so there are no tabs or address bar. Your high scores are saved there.
- **stops the game's local server** when you close the window.

The launcher reads its settings from `%LOCALAPPDATA%\Keystorm\launcher.config.json`:

| Setting | Default | Meaning |
| --- | --- | --- |
| `branch` | `""` | Branch to follow. Empty means the repository's default branch |
| `checkForUpdates` | `true` | Set to `false` to always launch the installed version |
| `browser` | `"auto"` | `auto` (Edge, then Chrome), `edge`, `chrome`, or `default` (a normal browser tab) |
| `port` | `47615` | Local port the game is served on. Your saved scores belong to this port |

If something goes wrong, the splash screen shows the error. Press **Enter** to retry or **L** to open the logs in `%LOCALAPPDATA%\Keystorm\logs`. To remove everything, run **`Uninstall-Keystorm.cmd`** in `%LOCALAPPDATA%\Keystorm\launcher`.

## Controls

| Key | Action |
| --- | --- |
| **A–Z** | Type a ship's word. The first letter locks onto the matching ship nearest the shield, and each correct letter fires |
| **Backspace** | Release the current lock. Letters you already typed on that ship stay typed |
| **Esc** | Pause or resume. The game also pauses when the window loses focus |
| **Enter** / type `start` | Start from the title screen |
| **Enter** / type `again` | Restart from the game-over screen (**Esc** returns to the title) |
| **R / M / N / Q** while paused | Restart, mute or unmute everything, turn the music on or off, quit to the title |

The speaker button in the bottom-right corner mutes sound at any time. The title screen also has **Music** and **Motion** options. *Auto* motion follows your OS reduced-motion setting, and you can also choose *Full* or *Reduced*.

## How it plays

- **Scouts** (amber) are fast and fragile, with short words. From wave 3 they sometimes arrive in swarms.
- **Fighters** (pink) move at standard speed and carry medium-length words.
- **Heavies** (violet) are slow and armoured, carry long words, and do 3 damage if they get through.
- Each correct letter fires a plasma bolt. The final letter calls down a lightning strike that shatters the ship and scatters its letters. Heavies shed one armour plate per letter.
- A wrong letter doesn't change the word. It breaks your combo and lowers your accuracy.
- **Combo → multiplier:** ×2 at 10 correct letters in a row, ×3 at 25, ×4 at 50 and ×5 at 80. Your lasers change colour at each tier. At ×5 you enter **Overdrive**: magenta lasers, a pulsing frame and a lead melody in the soundtrack.
- **Perfect word:** finish a word of 4+ letters without a miss for +25% points.
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
    Renderer.ts      world drawing, glow pass, lightning, shatter, Overdrive, beat-synced pulses
    Background.ts    nebula, starfield, gas giant, storm lightning, shooting stars, planet
    Particles.ts     pooled particles + floating score text
    sprites.ts       pre-rendered ship and glow sprites
  audio/
    AudioEngine.ts   Web Audio graph: limiter, reverb, echo, ducking, synth helpers
    Music.ts         adaptive procedural soundtrack (lookahead scheduler)
    Sound.ts         game sound effects, tuned to the music
  ui/UI.ts           DOM HUD, banners, title / pause / game-over screens
launcher/
  keystorm-core.mjs  update check, download, build and local server (Node, no dependencies)
  KeystormLauncher.cs  splash-screen launcher, compiled to KEYSTORM.exe on install
  Install-Keystorm.ps1 / Uninstall-Keystorm.ps1
  assets/            icon and splash art (sources and render script in assets/src)
  core/              layout, math, events, settings, storage, high scores
```

Gameplay code never touches the DOM or audio. `Game` emits typed events (`shot`, `kill`, `miss`, `baseHit`, `waveClear`, …), and the renderer, sound and UI subscribe to them. That keeps new features (enemy types, power-ups, modes) self-contained.
