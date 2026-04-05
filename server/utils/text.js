/**
 * Normaliza texto de entrada de forma consistente.
 *
 * @param {unknown} input
 * @returns {string}
 */
export function extractInputText(input) {
  if (typeof input !== 'string') return '';

  return input
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normaliza texto para comparaciones de comandos.
 * Convierte a minusculas y elimina diacriticos (tildes).
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeForMatching(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Comprueba si el texto contiene alguna palabra completa del listado.
 * Evita falsos positivos como "universidad" -> "si".
 *
 * @param {string} text
 * @param {string[]} words
 * @returns {boolean}
 */
export function hasAnyWord(text, words) {
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(^|\\s|[.,;:!?¡¿])(?:${escaped.join('|')})(?=$|\\s|[.,;:!?¡¿])`, 'i');
  return pattern.test(text);
}
