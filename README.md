# KEYSTORM

An arcade survival typing game. Funny, thought-provoking and slightly unhinged transmissions arrive one to three sentences at a time. Every word, with its punctuation, rides a ship falling toward the Spire, your planetary defence turret. Type the sentence exactly, with capitals, punctuation and spaces, and each correct character fires a laser. The last character of each word calls down lightning. If a word reaches the shield, the shield takes damage and that word is lost. When the shield fails, the run ends.

KEYSTORM learns how you type. It spots repeated mistakes, works your weak keys into the next sentences, matches the pace to your speed, and teaches new vocabulary along the way.

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

KEYSTORM installs to **`D:\Keystorm`** with Desktop and Start menu shortcuts. You don't need admin rights. You do need **Node.js 22 LTS** from [nodejs.org](https://nodejs.org), which builds the game.

**Without a copy of this project:** open PowerShell and run

```powershell
irm https://raw.githubusercontent.com/madema-art/typing_game/refs/heads/claude/brave-edison-9nckwo/launcher/Get-Keystorm.ps1 | iex
```

**From a copy of this project:** double-click **`Install-Keystorm.cmd`** in this folder.

The installer does the following:

1. Checks that Node.js 22+ is installed.
2. Creates `D:\Keystorm` if needed and checks that it can write there.
3. Builds **`KEYSTORM.exe`**, a small launcher with the KEYSTORM icon. It's compiled on your PC by the C# compiler that ships with Windows.
4. Downloads and builds the latest version of the game from GitHub.
5. Adds **KEYSTORM** shortcuts to your Desktop and Start menu.
6. If you installed before to `%LOCALAPPDATA%\Keystorm`, moves your saved high scores and settings to the new folder and removes the old copy.

To install somewhere else, pass `-InstallDir`:

```bat
Install-Keystorm.cmd -InstallDir "E:\Games\Keystorm"
```

With the web installer, set `$env:KEYSTORM_DIR = 'E:\Games\Keystorm'` first.

Each time you open the shortcut, a splash screen appears and the launcher:

- **checks GitHub for a newer version.** If there is one, it downloads and builds it before starting, and shows the progress on the splash. A failed update leaves the installed version working.
- **plays the installed version if you're offline.**
- **opens the game in its own window** using Edge or Chrome in app mode, so there are no tabs or address bar.
- **stops the game's local server** when you close the window.

Everything KEYSTORM keeps is inside the install folder:

| Path in `D:\Keystorm` | Contents |
| --- | --- |
| `KEYSTORM.exe` | The launcher the shortcuts open |
| `launcher\` | Update/server script, installer, uninstaller, icon and splash art |
| `game\` | The installed game and its build |
| `browser-profile\` | The game window's browser data, **including your saved high scores** |
| `launcher.config.json` | Launcher settings (see below) |
| `state.json` | Which version is installed |
| `logs\` | `core.log` (updates and server) and `launcher.log` |

Updates replace only `game\` and `launcher\`. Your scores and settings are never touched.

Launcher settings in `launcher.config.json`:

| Setting | Default | Meaning |
| --- | --- | --- |
| `branch` | `""` | Branch to follow. Empty means the repository's default branch |
| `checkForUpdates` | `true` | Set to `false` to always launch the installed version |
| `browser` | `"auto"` | `auto` (Edge, then Chrome), `edge`, `chrome`, or `default` (a normal browser tab) |
| `port` | `47615` | Local port the game is served on. Your saved scores belong to this port, so don't change it |

If something goes wrong, the splash screen shows the error. Press **Enter** to retry or **L** to open `D:\Keystorm\logs`.

To uninstall, run **`D:\Keystorm\launcher\Uninstall-Keystorm.cmd`**. It removes the shortcuts, the game and the launcher. It keeps your high scores and settings unless you choose to delete them, so reinstalling to the same folder brings them back.

## Controls

| Key | Action |
| --- | --- |
| **Any character** | Type the transmission. Capitals and punctuation must match; a wrong key is never inserted |
| **Space** | Moves the lock to the next word's ship (the transmission bar shows when a space is due) |
| **Esc** | Pause or resume. The game also pauses when the window loses focus |
| **Enter** / type `start` | Start from the title screen |
| **Enter** / type `again` | Restart from the game-over screen (**Esc** returns to the title) |
| **R / M / N / Q** while paused | Restart, mute or unmute everything, turn the music on or off, quit to the title |

The speaker button in the bottom-right corner mutes sound at any time. The title screen also has **Music** and **Motion** options. *Auto* motion follows your OS reduced-motion setting, and you can also choose *Full* or *Reduced*.

## How it plays

- **Transmissions.** Each one appears in the bar at the top, and its words break off as ships in reading order. Later words are spaced by your measured typing speed, so the next word you need is always the closest. If you're ahead, the next ship warps down to meet you.
- **Ship size follows word length.** Scouts carry short words, fighters medium ones, and heavies long ones (2 damage if they get through). Heavies shed one armour plate per letter.
- **Lexicon words** ride gold ships and score double. Typing one shows its definition. The same word returns later in a *different* sentence (later this run, then after days) until you've mastered it. Your collection is on the title screen under **Lexicon**.
- **Multi-sentence transmissions** (jokes with punchlines, mini-stories) appear once you're comfortable.
- Each correct character fires a plasma bolt. The final character of a word calls down a lightning strike that shatters the ship and scatters its letters.
- A wrong letter doesn't change the word. It breaks your combo and lowers your accuracy.
- **Combo → multiplier:** ×2 at 10 correct letters in a row, ×3 at 25, ×4 at 50 and ×5 at 80. Your lasers change colour at each tier. At ×5 you enter **Overdrive**: magenta lasers, a pulsing frame and a lead melody in the soundtrack.
- **Perfect word:** finish a word of 4+ letters without a miss for +25% points.
- **Streaks:** sentences typed without a single mistake build a *perfect streak*, with bonus points and milestone callouts. KEYSTORM also tracks your longest combo and your daily play streak, and keeps all-time records.
- **The coach.** It watches for patterns, such as *"You typed "o" for "i" again. Your fingers are gossiping."*, and the next sentences drill those keys and letter pairs. When a key improves, it says so.
- **Adaptive pace.** Convoys tighten when you're flawless and ease off when words get through. Sentence length and difficulty follow your skill.
- **Typing Intel.** After each run you get a keyboard heatmap of your strong and weak keys, your most common slip, speed against your average, streaks, and the words you met.
- **Your profile** (key statistics, records, streaks and lexicon) is saved in the browser. You can reset it from the Lexicon screen.
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
    profile.ts       long-term typing model: per-key/pair accuracy & speed, slips, records, streaks, vocabulary
    coach.ts         in-run pattern spotting, focus keys and commentary
    picker.ts        chooses each transmission: difficulty fit, weak-key practice, vocabulary reviews, novelty
    text/            sentence bank and jokes, lexicon, weak-key-aware sentence generator, passage parsing
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
  Get-Keystorm.ps1   one-command web installer (downloads the project, runs the installer)
  assets/            icon and splash art (sources and render script in assets/src)
  core/              layout, math, events, settings, storage, high scores
```

Gameplay code never touches the DOM or audio. `Game` emits typed events (`shot`, `kill`, `miss`, `baseHit`, `waveClear`, …), and the renderer, sound and UI subscribe to them. That keeps new features (enemy types, power-ups, modes) self-contained.
