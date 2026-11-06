import '@fontsource/orbitron/latin-600.css';
import '@fontsource/orbitron/latin-700.css';
import '@fontsource/orbitron/latin-800.css';
import '@fontsource/orbitron/latin-900.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '@fontsource/jetbrains-mono/latin-800.css';
import './style.css';
import { App } from './App';
import { FONT_DISPLAY, FONT_MONO } from './render/Renderer';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const app = new App(canvas);
app.start();

// Canvas text needs the web fonts loaded before measuring glyph widths.
Promise.all([
  document.fonts.load(`700 20px ${FONT_MONO}`),
  document.fonts.load(`800 20px ${FONT_DISPLAY}`),
  document.fonts.load(`600 20px ${FONT_DISPLAY}`),
])
  .catch(() => undefined)
  .then(() => app.fontsReady());

// Expose the app for debugging and automated play-testing in development builds only.
if (import.meta.env.DEV) (window as unknown as { __keystorm: App }).__keystorm = app;
