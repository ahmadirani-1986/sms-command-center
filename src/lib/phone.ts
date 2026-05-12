// Phone normalization shared between client and edge functions.
// Rules:
// - Strip spaces, dashes, brackets, dots, leading "+"
// - Convert leading "00" (IDD prefix) to bare international digits (e.g. 00966… -> 966…)
// - Result is digits-only, no leading "+"
export function normalizePhone(input: string): string {
  if (!input) return "";
  let s = String(input).trim();
  // Remove all common separators
  s = s.replace(/[\s\-()\.\u00a0]/g, "");
  // Strip leading "+"
  if (s.startsWith("+")) s = s.slice(1);
  // Convert leading "00" IDD to international digits
  if (s.startsWith("00")) s = s.slice(2);
  // Drop any remaining non-digits
  s = s.replace(/\D/g, "");
  return s;
}

export function formatPhoneDisplay(normalized: string): string {
  if (!normalized) return "";
  return "+" + normalized;
}

export function isValidNormalizedPhone(s: string): boolean {
  return /^[1-9]\d{6,14}$/.test(s);
}
