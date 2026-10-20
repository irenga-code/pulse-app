/** Turn Supabase Auth errors into plain language. */
export function authErrorMessage(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? 'Something went wrong. Please try again.';
  if (/invalid login credentials/i.test(msg)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(msg)) return 'Please confirm your email first. Check your inbox for the link.';
  if (/already registered|already been registered/i.test(msg)) return 'An account with this email already exists. Try signing in.';
  if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Please wait a few minutes and try again.';
  if (/password should be at least/i.test(msg)) return 'Password is too short (minimum 8 characters).';
  if (/same password|different from the old/i.test(msg)) return 'Choose a password you have not used before.';
  if (/banned|user is banned/i.test(msg)) return 'This account has been banned.';
  if (/failed to fetch|network/i.test(msg)) return 'Network problem. Check your connection and try again.';
  return msg;
}
