/** Turn Supabase Auth errors into plain language. */
export function authErrorMessage(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? 'Something went wrong. Please try again.';
  if (/mapped signup needs email confirmation off/i.test(msg)) {
    return 'Your account was created, but Supabase is waiting for an email confirmation. For phone + password sign-up, turn off "Confirm email" in Supabase (Authentication > Providers > Email).';
  }
  if (/email_address_invalid|email address .* is invalid/i.test(msg)) {
    return 'Supabase rejected the internal sign-in address for this number. Phone + password sign-up needs a different mapping domain.';
  }
  if (/phone already registered/i.test(msg)) return 'An account with this phone number already exists. Sign in instead.';
  if (/invalid login credentials/i.test(msg)) return 'Wrong phone number or password.';
  if (/email not confirmed/i.test(msg)) return 'Please confirm your email first. Check your inbox for the link.';
  if (/already registered|already been registered/i.test(msg)) return 'An account with this phone number already exists. Sign in instead.';
  if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Please wait a few minutes and try again.';
  if (/password should be at least/i.test(msg)) return 'Password is too short (minimum 8 characters).';
  if (/same password|different from the old/i.test(msg)) return 'Choose a password you have not used before.';
  if (/banned|user is banned/i.test(msg)) return 'This account has been banned.';
  if (/failed to fetch|network/i.test(msg)) return 'Network problem. Check your connection and try again.';
  if (/phone.*provider|sms.*provider|unsupported phone|phone_provider_disabled|phone signups? (are )?disabled/i.test(msg)) {
    return 'SMS codes are not switched on for Pulse yet. Sign in with your phone number and password instead.';
  }
  if (/token has expired|invalid.*(otp|token)|otp_expired/i.test(msg)) return 'That code is wrong or has expired. Request a new one.';
  if (/invalid phone|phone number.*invalid/i.test(msg)) return 'Enter the full number with country code, e.g. +256 700 000 000.';
  if (/phone.*already|already.*phone/i.test(msg)) return 'That number is already linked to another Pulse account.';
  return msg;
}
