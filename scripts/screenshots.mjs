/**
 * Capture docs/screenshots/*.png from extension/dev/mock.html.
 * Uses Playwright + system Google Chrome. Fake demo data only — no network APIs.
 * Crops each shot to the UI surface with a small margin (no filename labels).
 */
import { chromium } from 'playwright';
import { mkdir, access, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const mockPath = join(root, 'extension/dev/mock.html');
const outDir = join(root, 'docs/screenshots');
const MARGIN = 20;

const shots = [
  { id: 'shot-modal-languages', file: 'modal-languages.png', target: '.vt-panel' },
  { id: 'shot-translating', file: 'translating.png', target: '.vt-panel' },
  { id: 'shot-preview', file: 'preview.png', target: '.vt-panel' },
  { id: 'shot-widget', file: 'widget.png', target: '.studio-bg' },
  { id: 'shot-popup', file: 'popup.png', target: '.popup' },
  { id: 'shot-options', file: 'options.png', target: '.options-wrap' },
];

const obsolete = ['modal.png'];

async function screenshotWithMargin(page, locator, path, margin = MARGIN) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`No bounding box for ${path}`);
  const vp = page.viewportSize() ?? { width: 1440, height: 900 };
  const x = Math.max(0, box.x - margin);
  const y = Math.max(0, box.y - margin);
  const width = Math.min(vp.width - x, box.width + margin * 2);
  const height = Math.min(vp.height - y, box.height + margin * 2);
  await page.screenshot({ path, clip: { x, y, width, height } });
}

async function main() {
  await mkdir(outDir, { recursive: true });
  await access(mockPath);

  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });

  await page.goto(pathToFileURL(mockPath).href, { waitUntil: 'domcontentloaded' });

  for (const shot of shots) {
    const section = page.locator(`#${shot.id}`);
    await section.scrollIntoViewIfNeeded();
    await page.waitForTimeout(80);
    const target = section.locator(shot.target).first();
    const out = join(outDir, shot.file);
    await screenshotWithMargin(page, target, out);
    console.log('wrote', out);
  }

  for (const name of obsolete) {
    const p = join(outDir, name);
    try {
      await unlink(p);
      console.log('removed obsolete', p);
    } catch {
      /* absent */
    }
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
