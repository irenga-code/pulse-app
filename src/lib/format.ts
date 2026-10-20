/** 999 -> "999", 1234 -> "1.2K", 59432 -> "59K", 2_500_000 -> "2.5M" (always rounded down, like X and Instagram). */
export function formatCount(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '0';
  if (v < 1000) return String(Math.floor(v));
  const units: [number, string][] = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [size, suffix] of units) {
    if (v >= size) {
      const x = v / size;
      const text = x >= 10 ? String(Math.floor(x)) : String(Math.floor(x * 10) / 10);
      return text.replace(/\.0$/, '') + suffix;
    }
  }
  return String(Math.floor(v));
}
