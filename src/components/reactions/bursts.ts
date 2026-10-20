export type Burst = { id: number; emoji: string; x: number; drift: number };

let nextId = 1;
/** Build `count` bursts with random horizontal positions. */
export function makeBursts(emoji: string, count = 1): Burst[] {
  return Array.from({ length: count }, () => ({
    id: nextId++,
    emoji,
    x: 8 + Math.random() * 78,
    drift: Math.round((Math.random() - 0.5) * 70),
  }));
}
