/**
 * Dev-only: render extension/dev/mock.html and save PNGs to docs/screenshots/.
 * No network / no live YouTube API.
 */
import { chromium } from 'playwright';
import { mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');
const mockPath = join(__dirname, 'mock.html');
const outDir = join(root, 'docs/screenshots');

const shots = [
  { id: 'shot-modal', file: 'modal.png' },
  { id: 'shot-preview', file: 'preview.png' },
  { id: 'shot-popup', file: 'popup.png' },
  { id: 'shot-options', file: 'options.png' },
];

async function main() {
  await mkdir(outDir, { recursive: true });
  await access(mockPath);

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1100, height: 900 },
    deviceScaleFactor: 2,
  });

  await page.goto(pathToFileURL(mockPath).href, { waitUntil: 'networkidle' });

  for (const shot of shots) {
    const el = page.locator(`#${shot.id}`);
    await el.scrollIntoViewIfNeeded();
    const out = join(outDir, shot.file);
    await el.screenshot({ path: out });
    console.log('wrote', out);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
