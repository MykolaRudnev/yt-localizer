/**
 * Capture docs/screenshots/*.png from the real UI.
 * Bundles extension/dev/shot-*.ts (real views + fake chrome APIs with demo data,
 * see extension/dev/fake-chrome.ts) with esbuild, opens them in Playwright and
 * crops each shot to its surface. Fake demo data only — no network APIs.
 */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const ext = join(root, 'extension');
const outDir = join(root, 'docs/screenshots');
const MARGIN = 20;

const shots = [
  { page: 'studio', hash: 'picker', file: 'language-picker.png', target: '.vt-panel' },
  { page: 'studio', hash: 'progress', file: 'progress.png', target: '.vt-panel' },
  { page: 'studio', hash: 'preview', file: 'review.png', target: '.vt-panel' },
  { page: 'studio', hash: 'review', file: 'shortened-titles.png', target: '.vt-panel' },
  { page: 'studio', hash: 'widget', file: 'job-widget.png', target: '#vt-job-widget' },
  { page: 'popup', file: 'toolbar-popup.png', target: '.popup', viewport: { width: 360, height: 900 }, margin: 0 },
  { page: 'options', file: 'options-page.png', target: '.wrap', viewport: { width: 1100, height: 1400 } },
];

const obsolete = [
  'modal.png',
  // Pre-redesign names (renamed so GitHub's image cache can't serve the old shots).
  ...['modal-languages', 'translating', 'preview', 'review-shortened', 'widget', 'popup', 'options'].map(
    (n) => `${n}.png`,
  ),
];

async function bundle(tmp) {
  const common = {
    bundle: true,
    logLevel: 'warning',
    alias: { '@shared': join(root, 'shared/src') },
    loader: { '.json': 'json' },
  };
  await build({
    ...common,
    entryPoints: {
      studio: join(ext, 'dev/shot-studio.ts'),
      popup: join(ext, 'dev/shot-popup.ts'),
      options: join(ext, 'dev/shot-options.ts'),
    },
    format: 'iife',
    outdir: tmp,
  });
  await build({
    ...common,
    entryPoints: {
      'studio-css': join(ext, 'src/content.css'),
      'popup-css': join(ext, 'src/popup.css'),
      'options-css': join(ext, 'src/options.css'),
    },
    outdir: tmp,
  });

  // Studio: an empty light page standing in for YouTube Studio.
  await writeFile(
    join(tmp, 'studio.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="studio-css.css">
<style>body{margin:0;min-height:100vh;background:#f9f9f9;font-family:Roboto,Arial,sans-serif}</style></head>
<body><script src="studio.js"></script></body></html>`,
  );
  // Popup / options: the real HTML with the dev bundles swapped in.
  for (const name of ['popup', 'options']) {
    const html = (await readFile(join(ext, `${name}.html`), 'utf8'))
      .replace(/<link rel="stylesheet" href="\/src\/[\w.]+\.css" \/>/, `<link rel="stylesheet" href="${name}-css.css" />`)
      .replace(/<script type="module" src="\/src\/[\w.]+\.ts"><\/script>/, `<script src="${name}.js"></script>`);
    await writeFile(join(tmp, `${name}.html`), html);
  }
}

async function screenshotWithMargin(page, locator, path, margin) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`No bounding box for ${path}`);
  const vp = page.viewportSize();
  const x = Math.max(0, box.x - margin);
  const y = Math.max(0, box.y - margin);
  const width = Math.min(vp.width - x, box.width + margin * 2);
  const height = Math.min(vp.height - y, box.height + margin * 2);
  await page.screenshot({ path, clip: { x, y, width, height } });
}

async function launch() {
  // Prefer the system Chrome; fall back to Playwright's bundled Chromium.
  const executablePath = process.env.CHROME_PATH;
  if (executablePath) return chromium.launch({ executablePath });
  try {
    return await chromium.launch({ channel: 'chrome' });
  } catch {
    return chromium.launch();
  }
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const tmp = await mkdtemp(join(tmpdir(), 'ytl-shots-'));
  try {
    await bundle(tmp);
    const browser = await launch();
    for (const shot of shots) {
      const page = await browser.newPage({
        viewport: shot.viewport ?? { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        colorScheme: 'light',
      });
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));
      const url = pathToFileURL(join(tmp, `${shot.page}.html`)).href + (shot.hash ? `#${shot.hash}` : '');
      await page.goto(url, { waitUntil: 'load' });
      if (shot.page === 'studio') await page.waitForSelector('html[data-ready]');
      await page.waitForTimeout(300);
      if (errors.length) throw new Error(`${shot.file}: ${errors.join('; ')}`);
      const out = join(outDir, shot.file);
      await screenshotWithMargin(page, page.locator(shot.target).first(), out, shot.margin ?? MARGIN);
      console.log('wrote', out);
      await page.close();
    }
    await browser.close();
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  for (const name of obsolete) {
    try {
      await unlink(join(outDir, name));
      console.log('removed obsolete', name);
    } catch {
      /* absent */
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
