declare module 'twemoji-parser' {
  export type EmojiEntity = { url: string; indices: [number, number]; text: string; type: 'emoji' };
  export function parse(text: string, options?: { assetType?: 'svg' | 'png'; buildUrl?: (codepoints: string, assetType: string) => string }): EmojiEntity[];
  export function toCodePoints(unicodeSurrogates: string): string[];
}
