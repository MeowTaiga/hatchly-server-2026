/**
 * Normalises a raw phone number for search/storage.
 * Strips non-digits and ensures E.164 format.
 *
 * - Strips every non-digit character
 * - 10-digit US numbers get `+1` prepended
 * - 11-digit numbers starting with `1` get `+` prepended
 * - Already prefixed with `+` → returned as-is
 *
 * @example
 * normalizePhone('(555) 123-4567')  // '+15551234567'
 * normalizePhone('5551234567')      // '+15551234567'
 */
export function normalizePhone(raw: string): string {
  if (raw.startsWith('+')) return raw;

  const digits = raw.replace(/\D/g, '');

  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;

  return `+${digits}`;
}

/**
 * Normalises a raw phone number string into E.164 format.
 *
 * - Strips every non-digit character
 * - 10-digit US numbers get `+1` prepended
 * - 11-digit numbers starting with `1` get `+` prepended
 * - Already prefixed with `+` → returned as-is
 *
 * @example
 * formatE164('(555) 123-4567')  // '+15551234567'
 * formatE164('15551234567')     // '+15551234567'
 * formatE164('+15551234567')    // '+15551234567'
 */
export function formatE164(raw: string): string {
  return normalizePhone(raw);
}
