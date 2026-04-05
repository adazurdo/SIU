import { SYSTEM_MODES, VOICE_INTENTS } from '../command-contract.js';
import { extractInputText, hasAnyWord, normalizeForMatching } from '../utils/text.js';

/**
 * Limpia y valida el comando recibido por socket.
 *
 * @param {unknown} command
 * @returns {string|null}
 */
export function sanitizeIncomingCommand(command) {
  const trimmed = extractInputText(command);
  if (trimmed.length === 0) return null;

  // Limpiar muletillas frecuentes al inicio del dictado: "e,", "eh,", "y,", etc.
  const withoutFiller = trimmed.replace(/^(?:e+|eh+|em+|mmm+|y)\s*[,;:.!?-]*\s*/i, '').trim();
  return withoutFiller.length > 0 ? withoutFiller : null;
}

/**
 * Procesa un comando de voz y determina la accion a realizar.
 *
 * @param {string} command
 * @param {string} currentMode
 * @returns {{action: string, message: string, newMode: string, pendingAction?: any, executeNow?: any}}
 */
export function processVoiceCommand(command, currentMode) {
  const normalizedCommand = normalizeForMatching(command);

  const destination = extractDestinationFromCommand(normalizedCommand);
  if (destination) {
    return {
      action: VOICE_INTENTS.NAVIGATE_TO_DESTINATION,
      message: `Iniciando navegacion por voz hacia "${destination}"...`,
      newMode: SYSTEM_MODES.NAVIGATING,
      pendingAction: null,
      executeNow: {
        type: 'start_voice_navigation',
        payload: { destination }
      }
    };
  }

  if (normalizedCommand.includes('buscar gasolinera') || normalizedCommand.includes('gasolinera')) {
    return {
      action: VOICE_INTENTS.SEARCH_GAS_STATION,
      message: 'Iniciando navegacion por voz a gasolinera cercana...',
      newMode: SYSTEM_MODES.NAVIGATING,
      pendingAction: null,
      executeNow: {
        type: 'start_voice_navigation',
        payload: { destination: 'gasolinera cerca de mi' }
      }
    };
  }

  const callTarget = extractCallTarget(normalizedCommand);
  if (callTarget) {
    return {
      action: VOICE_INTENTS.CALL_CONTACT,
      message: `Llamada detectada a "${callTarget}". Di "confirmar" para ejecutar.`,
      newMode: SYSTEM_MODES.CONFIRMING,
      pendingAction: {
        type: 'call_contact',
        payload: { contactName: callTarget }
      }
    };
  }

  if (hasAnyWord(normalizedCommand, ['cancelar', 'cancel'])) {
    return {
      action: VOICE_INTENTS.CANCEL,
      message: 'Accion cancelada.',
      newMode: SYSTEM_MODES.IDLE,
      pendingAction: null,
      executeNow: {
        type: 'stop_voice_navigation',
        payload: {}
      }
    };
  }

  if (isStrictConfirmation(normalizedCommand)) {
    return {
      action: VOICE_INTENTS.CONFIRM,
      message: 'Accion confirmada. Ejecutando actuador...',
      newMode: SYSTEM_MODES.NAVIGATING,
      pendingAction: null
    };
  }

  if (hasAnyWord(normalizedCommand, ['repetir'])) {
    return {
      action: VOICE_INTENTS.REPEAT,
      message: 'Repitiendo ultima indicacion...',
      newMode: currentMode,
      executeNow: {
        type: 'repeat_last_message',
        payload: {}
      }
    };
  }

  return {
    action: VOICE_INTENTS.UNKNOWN,
    message: `Comando no reconocido: "${command}"`,
    newMode: currentMode
  };
}

/**
 * Reconoce confirmaciones cortas y explicitas.
 *
 * @param {string} text
 * @returns {boolean}
 */
function isStrictConfirmation(text) {
  return /^(confirmar|si|sí|vale|ok|de acuerdo)[.!?]*$/.test(text.trim());
}

/**
 * Extrae un destino a partir de comandos naturales de navegacion.
 *
 * @param {string} normalizedCommand
 * @returns {string|null}
 */
function extractDestinationFromCommand(normalizedCommand) {
  const patterns = [
    /(?:dime\s+)?como\s+llegar\s+a\s+(.+)/,
    /(?:quiero\s+)?ir\s+a\s+(.+)/,
    /llevame\s+a\s+(.+)/,
    /navega\s+a\s+(.+)/,
    /ruta\s+a\s+(.+)/
  ];

  for (const pattern of patterns) {
    const match = normalizedCommand.match(pattern);
    if (!match || !match[1]) continue;

    const cleaned = match[1]
      .replace(/[.,;:!?]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleaned.length > 0) return cleaned;
  }

  return null;
}

/**
 * Extrae el objetivo de una llamada en comandos tipo:
 * - llamar a X
 * - llamar al numero X
 * - llama a X
 * - llama al numero X
 *
 * @param {string} normalizedCommand
 * @returns {string|null}
 */
function extractCallTarget(normalizedCommand) {
  const match = normalizedCommand.match(/(?:llamar|llama)\s+a(?:l)?\s+(.+)/);
  if (!match || !match[1]) return null;

  const cleaned = match[1]
    .replace(/^(?:el\s+)?numero\s+/i, '')
    .replace(/[.,;:!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.length > 0 ? cleaned : null;
}
