/** "+256 (700) 000-000" -> "+256700000000". Returns null unless it has 7-15 digits (E.164). */
export function toE164(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return `+${digits}`;
}

/** "+256700123456" -> "+256 700 123 456" for display (groups of three after the country code guess). */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const d = e164.replace(/\D/g, '');
  if (d.length < 7) return `+${d}`;
  const cc = d.length > 10 ? d.slice(0, d.length - 9) : d.slice(0, 1);
  const rest = d.slice(cc.length).replace(/(\d{3})(?=\d)/g, '$1 ');
  return `+${cc} ${rest}`;
}

/**
 * Selected country code + what the user typed -> E.164, or null if it cannot be a real number.
 * "0700 000 000" with +256 -> "+256700000000" (the leading trunk 0 is dropped). A number typed with its own
 * "+" or "00" prefix wins over the selected country.
 */
export function joinE164(dial: string, input: string): string | null {
  const raw = input.trim();
  if (raw.startsWith('+')) return toE164(raw);
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) return toE164(digits.slice(2));
  digits = digits.replace(/^0+/, '');
  // someone typed the country code without the "+" ("256700000000" with Uganda picked)
  if (digits.startsWith(dial) && digits.length - dial.length >= 8) digits = digits.slice(dial.length);
  if (digits.length < 4 || dial.length + digits.length > 15 || dial.length + digits.length < 7) return null;
  return `+${dial}${digits}`;
}

/**
 * Development sign-in without an SMS provider: phone + password accounts are Supabase email accounts whose address is
 * derived from the number ("+256789175095" -> "256789175095@pulse.local"). The address is never shown in the UI.
 * Set VITE_PHONE_AUTH=sms to use real SMS one-time codes instead (needs the Phone provider in Supabase).
 */
export const PHONE_AUTH_MODE: 'mapped' | 'sms' = import.meta.env.VITE_PHONE_AUTH === 'sms' ? 'sms' : 'mapped';
export const PULSE_LOCAL_DOMAIN = 'pulse.local';
export const phoneToEmail = (e164: string) => `${e164.replace(/\D/g, '')}@${PULSE_LOCAL_DOMAIN}`;
export const isPulseLocalEmail = (email: string | null | undefined) => !!email && email.toLowerCase().endsWith(`@${PULSE_LOCAL_DOMAIN}`);
/** "256789175095@pulse.local" -> "+256789175095" */
export const phoneFromPulseEmail = (email: string | null | undefined) =>
  (isPulseLocalEmail(email) ? `+${email!.split('@')[0].replace(/\D/g, '')}` : null);
