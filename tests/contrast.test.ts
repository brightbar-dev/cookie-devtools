import { describe, it, expect } from 'vitest';
import css from '../ui/app.css?raw';
import { contrastRatio, parseHex, relativeLuminance, themeTokens } from '../utils/contrast';

// WCAG AA for normal-size text.
const AA = 4.5;

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(contrastRatio('#fff', '#767676')).toBeCloseTo(4.54, 2);
  });

  it('parses 3- and 6-digit hex and rejects anything else', () => {
    expect(parseHex('#abc')).toEqual([170, 187, 204]);
    expect(parseHex('rgb(0,0,0)')).toBeNull();
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
    expect(() => contrastRatio('red', '#fff')).toThrow();
  });
});

describe('theme colours in ui/app.css meet WCAG AA', () => {
  const { light, dark } = themeTokens(css);

  // [text token, background token] pairs as the UI actually uses them.
  const TEXT_ON_SURFACE: Array<[string, string]> = [
    ['--text', '--bg'], ['--text', '--bg-secondary'], ['--text', '--bg-hover'],
    ['--text-secondary', '--bg'], ['--text-secondary', '--bg-secondary'], ['--text-secondary', '--bg-hover'],
    ['--text-muted', '--bg'], ['--text-muted', '--bg-secondary'], ['--text-muted', '--bg-hover'],
    ['--accent', '--bg'], ['--danger-text', '--bg'], ['--danger-text', '--bg-secondary'],
    ['--warning-text', '--bg'], ['--warning-text', '--bg-secondary'], ['--success-text', '--bg'],
    ['--on-accent', '--accent'],
  ];
  // Badges and solid danger surfaces carry white text in both themes.
  const WHITE_ON: string[] = [
    '--badge-secure', '--badge-httponly', '--badge-session', '--badge-samesite-strict', '--badge-samesite-lax',
    '--badge-samesite-none', '--badge-partitioned', '--badge-protected', '--danger',
  ];

  for (const [name, tokens] of [['light', light], ['dark', dark]] as const) {
    for (const [fg, bg] of TEXT_ON_SURFACE) {
      it(`${name}: ${fg} on ${bg}`, () => {
        expect(tokens[fg], `${fg} missing`).toBeDefined();
        expect(tokens[bg], `${bg} missing`).toBeDefined();
        expect(contrastRatio(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(AA);
      });
    }
    for (const bg of WHITE_ON) {
      it(`${name}: white on ${bg}`, () => {
        expect(tokens[bg], `${bg} missing`).toBeDefined();
        expect(contrastRatio('#ffffff', tokens[bg]!)).toBeGreaterThanOrEqual(AA);
      });
    }
  }
});
