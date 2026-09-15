// WCAG 2.x contrast, and the colour tokens of a stylesheet's light (:root) and dark (body.dark) themes.

export function parseHex(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const hex = m[1]!.length === 3 ? m[1]!.split('').map((c) => c + c).join('') : m[1]!;
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const a = parseHex(foreground);
  const b = parseHex(background);
  if (!a || !b) throw new Error(`not a hex colour: ${!a ? foreground : background}`);
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function tokensIn(block: string | undefined): Record<string, string> {
  const tokens: Record<string, string> = {};
  if (!block) return tokens;
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-f]{3,6})\s*;/gi)) tokens[m[1]!] = m[2]!;
  return tokens;
}

/** Hex colour tokens of the light theme, and the dark theme with its overrides applied. */
export function themeTokens(css: string): { light: Record<string, string>; dark: Record<string, string> } {
  const light = tokensIn(/:root\s*\{([^}]*)\}/.exec(css)?.[1]);
  const dark = { ...light, ...tokensIn(/body\.dark\s*\{([^}]*)\}/.exec(css)?.[1]) };
  return { light, dark };
}
