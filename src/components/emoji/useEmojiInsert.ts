import { useCallback, type RefObject } from 'react';
import { insertAtCaret } from '@/components/emoji/emojiData';

/** Returns an onPick handler that puts an emoji at the caret of an input/textarea and keeps the caret after it. */
export function useEmojiInsert(
  ref: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  value: string,
  setValue: (v: string) => void,
  max?: number
) {
  return useCallback(
    (emoji: string) => {
      const { value: next, caret } = insertAtCaret(ref.current, value, emoji, max);
      setValue(next);
      requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(caret, caret);
      });
    },
    [ref, value, setValue, max]
  );
}
