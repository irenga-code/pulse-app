import { useSyncExternalStore } from 'react';
import { formatPhone } from '@/lib/phone';

/**
 * Your contacts, on this device only (like a phone's address book): the number you used to reach someone and the
 * name you saved for them. Pulse never shows anyone's number to people who did not already have it, so a number
 * appears here only because you typed it in.
 */
export type Contact = { phone?: string; name?: string; /** Your private notes about them ("Add text to note"). */ note?: string };
type Book = Record<string, Contact>;

const KEY = 'pulse:contacts';
const listeners = new Set<() => void>();

function load(): Book {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return raw && typeof raw === 'object' ? (raw as Book) : {};
  } catch {
    return {};
  }
}
let book: Book = load();

function save(next: Book) {
  book = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* per-device only */ }
  listeners.forEach((fn) => fn());
}
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => { if (e.key === KEY) { book = load(); listeners.forEach((fn) => fn()); } });
}

export const getContacts = () => book;
export function subscribeContacts(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export const useContacts = () => useSyncExternalStore(subscribeContacts, getContacts, getContacts);

export const NOTE_MAX = 2000;

/** Merge into a contact; an empty name or note removes it. */
export function saveContact(userId: string, patch: Contact) {
  const cur = book[userId] ?? {};
  const next: Contact = { ...cur, ...patch };
  if (patch.name !== undefined && !patch.name.trim()) delete next.name;
  else if (next.name) next.name = next.name.trim();
  if (patch.note !== undefined && !patch.note.trim()) delete next.note;
  else if (next.note) next.note = next.note.slice(0, NOTE_MAX);
  save({ ...book, [userId]: next });
}

/** "Add text to note": append a message's text to your private note about this person. */
export function appendToContactNote(userId: string, text: string) {
  const cur = book[userId]?.note?.trim();
  saveContact(userId, { note: cur ? `${cur}\n${text.trim()}` : text.trim() });
}

/**
 * How someone is shown, WhatsApp-style: your saved name; else the number you know them by; else their Pulse name.
 * `subtitle` is their Pulse name ("~Amara") when the title is a number.
 */
export function contactLabel(contact: Contact | undefined, pulseName: string | null | undefined) {
  if (contact?.name) return { title: contact.name, subtitle: null as string | null, phone: contact.phone ? formatPhone(contact.phone) : null };
  if (contact?.phone) return { title: formatPhone(contact.phone), subtitle: pulseName ? `~${pulseName}` : null, phone: formatPhone(contact.phone) };
  return { title: pulseName ?? 'Pulse user', subtitle: null, phone: null };
}
