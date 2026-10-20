export type EmojiCategory = { id: string; label: string; icon: string; emojis: [emoji: string, keywords: string][] };

/** Curated set for nightlife chat (kept small on purpose: no 3,000-emoji dependency). */
export const EMOJI_CATEGORIES: EmojiCategory[] = [
  { id: 'night', label: 'Nightlife', icon: '🪩', emojis: [
    ['🪩', 'disco ball club'], ['🎉', 'party celebrate'], ['🎊', 'confetti'], ['🍾', 'champagne bottle celebrate'], ['🥂', 'cheers toast'],
    ['🍻', 'beers cheers'], ['🍺', 'beer'], ['🍹', 'cocktail tropical drink'], ['🍸', 'cocktail martini'], ['🥃', 'whisky tumbler'],
    ['🎶', 'music notes'], ['🎵', 'music note'], ['🎤', 'microphone mc karaoke'], ['🎧', 'headphones dj'], ['🎛️', 'mixer dj controls'],
    ['🔊', 'loud speaker'], ['💃', 'dance woman'], ['🕺', 'dance man'], ['🔥', 'fire lit hot'], ['✨', 'sparkles'],
    ['🌙', 'moon night'], ['🌃', 'night city'], ['🚖', 'taxi ride'], ['🏍️', 'boda motorbike'], ['🎟️', 'ticket entry'],
    ['🕶️', 'sunglasses cool'], ['👑', 'crown vip'], ['💎', 'diamond vip'], ['🚬', 'smoke'], ['🍕', 'pizza late night'],
  ] },
  { id: 'smileys', label: 'Smileys', icon: '😀', emojis: [
    ['😀', 'grin'], ['😄', 'smile'], ['😁', 'beam'], ['😂', 'laugh tears joy'], ['🤣', 'rofl'], ['😊', 'blush'], ['😍', 'love eyes'],
    ['🥰', 'adore'], ['😘', 'kiss'], ['😎', 'cool sunglasses'], ['🤩', 'star struck'], ['🥳', 'party face'], ['😏', 'smirk'], ['😜', 'wink tongue'],
    ['🤪', 'crazy'], ['😮', 'wow surprised'], ['😱', 'shock'], ['😅', 'sweat'], ['🙃', 'upside down'], ['😴', 'sleep tired'],
    ['🥴', 'woozy drunk'], ['🤯', 'mind blown'], ['😭', 'cry'], ['🙈', 'see no evil'], ['🤭', 'oops giggle'],
  ] },
  { id: 'gestures', label: 'Gestures', icon: '👏', emojis: [
    ['👏', 'clap applause'], ['🙌', 'raise hands'], ['🙏', 'thanks pray'], ['👍', 'thumbs up'], ['👎', 'thumbs down'], ['👌', 'ok'],
    ['✌️', 'peace'], ['🤞', 'fingers crossed'], ['🤟', 'love you'], ['🤘', 'rock'], ['👊', 'fist bump'], ['💪', 'strong'],
    ['🫶', 'heart hands'], ['👋', 'wave'], ['🤝', 'deal handshake'], ['👀', 'eyes look'],
  ] },
  { id: 'hearts', label: 'Hearts', icon: '❤️', emojis: [
    ['❤️', 'red heart love'], ['🧡', 'orange heart'], ['💛', 'yellow heart'], ['💚', 'green heart'], ['💙', 'blue heart'], ['💜', 'purple heart'],
    ['🖤', 'black heart'], ['🤍', 'white heart'], ['💖', 'sparkling heart'], ['💘', 'cupid'], ['💯', 'hundred'], ['💥', 'boom'], ['⚡', 'lightning'], ['🌟', 'star'],
  ] },
  { id: 'places', label: 'Places & flags', icon: '📍', emojis: [
    ['📍', 'pin location'], ['🇺🇬', 'uganda flag'], ['🏙️', 'city'], ['🌆', 'dusk city'], ['🏖️', 'beach'], ['🌴', 'palm'], ['🦁', 'lion simba'], ['🐆', 'panther'],
    ['🌍', 'africa world'], ['🛣️', 'road'], ['🚗', 'car'], ['🛵', 'scooter'],
  ] },
];

export const ALL_EMOJIS = EMOJI_CATEGORIES.flatMap((c) => c.emojis);

/** Insert text at the caret of an input/textarea and return the new value + caret position. */
export function insertAtCaret(el: HTMLInputElement | HTMLTextAreaElement | null, current: string, insert: string, max?: number) {
  const start = el?.selectionStart ?? current.length;
  const end = el?.selectionEnd ?? current.length;
  let next = current.slice(0, start) + insert + current.slice(end);
  if (max && next.length > max) next = current;
  return { value: next, caret: start + insert.length };
}
