/**
 * Capture docs/screenshots/*.png from extension/dev/mock.html.
 * Uses Playwright + system Google Chrome. Fake demo data only — no network APIs.
 */
import { chromium } from 'playwright';
import { mkdir, access, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const mockPath = join(root, 'extension/dev/mock.html');
const outDir = join(root, 'docs/screenshots');

const shots = [
  { id: 'shot-modal-languages', file: 'modal-languages.png' },
  { id: 'shot-translating', file: 'translating.png' },
  { id: 'shot-preview', file: 'preview.png' },
  { id: 'shot-widget', file: 'widget.png' },
  { id: 'shot-popup', file: 'popup.png' },
  { id: 'shot-options', file: 'options.png' },
];

const obsolete = ['modal.png'];

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
    const el = page.locator(`#${shot.id}`);
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(80);
    const out = join(outDir, shot.file);
    await el.screenshot({ path: out });
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
