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
