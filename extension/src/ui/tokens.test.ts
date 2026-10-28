import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Design-system lint: component CSS consumes tokens only (see design.md).
 * Raw values and Tier 1 colour ramps are allowed in ui/tokens.css alone.
 */
const SRC = resolve(__dirname, '..');
const COMPONENT_CSS = ['ui/components.css', 'content.css', 'popup.css', 'options.css'];

const read = (rel: string) =>
  readFileSync(resolve(SRC, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('component CSS uses tokens only', () => {
  for (const file of COMPONENT_CSS) {
    describe(file, () => {
      const css = read(file);

      it('has no raw hex / rgb / hsl / oklch colours', () => {
        expect(css.match(/#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|oklch)\(/gi) ?? []).toEqual([]);
      });

      it('has no raw px values', () => {
        // @media breakpoints can't use var(), so they are the one allowed exception.
        const rules = css.replace(/@media[^{]*/g, '');
        expect(rules.match(/\b\d+(?:\.\d+)?px\b/g) ?? []).toEqual([]);
      });

      it('never uses Tier 1 colour ramps directly', () => {
        expect(css.match(/--ytl-(?:blue|slate|amber|red|black)-[\w-]+/g) ?? []).toEqual([]);
      });

      it('only references --ytl-* custom properties', () => {
        const foreign = [...css.matchAll(/var\(\s*(--[\w-]+)/g)]
          .map((m) => m[1])
          .filter((name) => !name.startsWith('--ytl-'));
        expect(foreign).toEqual([]);
      });
    });
  }

  it('every referenced token is defined in tokens.css', () => {
    const tokens = read('ui/tokens.css');
    const defined = new Set([...tokens.matchAll(/(--ytl-[\w-]+)\s*:/g)].map((m) => m[1]));
    const missing = new Set<string>();
    for (const file of COMPONENT_CSS) {
      for (const m of read(file).matchAll(/var\(\s*(--ytl-[\w-]+)/g)) {
        if (!defined.has(m[1])) missing.add(`${file}: ${m[1]}`);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('palette has no green hue (accent is blue)', () => {
    expect(read('ui/tokens.css')).not.toMatch(/green|emerald|lime/i);
  });
});
