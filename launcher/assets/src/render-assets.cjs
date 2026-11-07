/**
 * Regenerates launcher/assets/keystorm.ico and launcher/assets/splash.png.
 * Dev-only tool (not needed to play): requires Playwright (`npm i -g playwright`)
 * and Python 3 with Pillow for the ICO packing step.
 *
 *   node launcher/assets/src/render-assets.cjs
 */
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const SRC = __dirname;
const OUT = path.resolve(SRC, '..');
const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

(async () => {
  const browser = await chromium.launch();
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ks-icon-'));
  // Icon frames
  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const simple = size <= 32 ? '&simple=1' : '';
    await page.goto('file://' + path.join(SRC, 'icon.html') + `?size=${size}${simple}`);
    await page.waitForTimeout(100);
    await page.locator('#icon').screenshot({ path: path.join(tmp, `icon-${size}.png`), omitBackground: true });
    await page.close();
  }
  // Splash at 2x for crisp high-DPI display
  const page = await browser.newPage({ viewport: { width: 720, height: 405 }, deviceScaleFactor: 2 });
  await page.goto('file://' + path.join(SRC, 'splash.html'));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, 'splash.png') });
  await browser.close();

  execFileSync('python3', ['-I', path.join(SRC, 'pack-ico.py'), path.join(OUT, 'keystorm.ico'), ...SIZES.map((s) => path.join(tmp, `icon-${s}.png`))], { stdio: 'inherit' });
  fs.copyFileSync(path.join(tmp, 'icon-256.png'), path.join(OUT, 'icon-256.png'));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('Wrote', path.join(OUT, 'keystorm.ico'), 'and', path.join(OUT, 'splash.png'));
})();
