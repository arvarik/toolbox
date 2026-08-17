/**
 * @fileoverview Credential masking helpers.
 *
 * API keys must never travel back to the browser in plain text.
 * Every GET response that includes a stored credential runs it
 * through maskSecret() first.
 */

/**
 * Mask a secret value for display.
 * Returns the mask characters plus the last 4 characters of the secret.
 * A secret with 4 or fewer characters returns mask characters only,
 * so the full value never leaks.
 *
 * @param {string|null|undefined} value - The secret to mask
 * @returns {string} The masked value (e.g. '••••1234') or '' when empty
 */
export function maskSecret(value) {
  if (!value || typeof value !== 'string') return ''
  if (value.length <= 4) return '••••'
  return `••••${value.slice(-4)}`
}

/**
 * Check if a value looks like an already-masked secret.
 * The settings UI sends masked values back on unrelated form saves.
 * The server must not overwrite a real key with its own mask.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isMaskedValue(value) {
  return typeof value === 'string' && value.startsWith('••••')
}
