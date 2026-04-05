/**
 * Contrato de voz y maquina de estados del backend.
 *
 * Centraliza intents, modos y reglas de transicion permitidas para
 * evitar divergencias entre parser, Socket.IO y futuras pruebas.
 */

export const SYSTEM_MODES = Object.freeze({
  IDLE: 'idle',
  LISTENING: 'listening',
  CONFIRMING: 'confirming',
  NAVIGATING: 'navigating'
});

export const VOICE_INTENTS = Object.freeze({
  NAVIGATE_TO_DESTINATION: 'navigate_to_destination',
  SEARCH_GAS_STATION: 'search_gas_station',
  CALL_CONTACT: 'call_contact',
  CANCEL: 'cancel',
  CONFIRM: 'confirm',
  REPEAT: 'repeat',
  UNKNOWN: 'unknown',
  INVALID: 'invalid'
});

const MODE_TRANSITIONS = Object.freeze({
  [SYSTEM_MODES.IDLE]: new Set([
    SYSTEM_MODES.IDLE,
    SYSTEM_MODES.LISTENING,
    SYSTEM_MODES.CONFIRMING,
    SYSTEM_MODES.NAVIGATING
  ]),
  [SYSTEM_MODES.LISTENING]: new Set([
    SYSTEM_MODES.IDLE,
    SYSTEM_MODES.LISTENING,
    SYSTEM_MODES.CONFIRMING,
    SYSTEM_MODES.NAVIGATING
  ]),
  [SYSTEM_MODES.CONFIRMING]: new Set([
    SYSTEM_MODES.IDLE,
    SYSTEM_MODES.CONFIRMING,
    SYSTEM_MODES.NAVIGATING
  ]),
  [SYSTEM_MODES.NAVIGATING]: new Set([
    SYSTEM_MODES.IDLE,
    SYSTEM_MODES.CONFIRMING,
    SYSTEM_MODES.NAVIGATING
  ])
});

/**
 * Normaliza una transicion de estado solicitada por un intent.
 * Si la transicion no es valida, conserva el modo actual.
 *
 * @param {string} currentMode
 * @param {string | undefined | null} requestedMode
 * @returns {string}
 */
export function resolveModeTransition(currentMode, requestedMode) {
  if (!requestedMode || !isKnownMode(requestedMode)) return currentMode;

  const allowedNextModes = MODE_TRANSITIONS[currentMode];
  if (!allowedNextModes) return currentMode;

  return allowedNextModes.has(requestedMode) ? requestedMode : currentMode;
}

/**
 * Comprueba si un modo pertenece al contrato conocido.
 *
 * @param {string} mode
 * @returns {boolean}
 */
export function isKnownMode(mode) {
  return Object.values(SYSTEM_MODES).includes(mode);
}
