import { extractInputText } from '../utils/text.js';

const MAX_COMMAND_LENGTH = 180;
const MAX_STATUS_MESSAGE_LENGTH = 240;

/**
 * @param {unknown} payload
 */
export function validateVoiceCommandPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return invalid('INVALID_PAYLOAD_SHAPE', 'Payload de voz invalido.');
  }

  const command = extractInputText(payload.command);

  if (!command) {
    return invalid('INVALID_COMMAND_EMPTY', 'No se recibio un comando de voz valido.');
  }

  if (command.length > MAX_COMMAND_LENGTH) {
    return invalid('INVALID_COMMAND_TOO_LONG', `El comando excede ${MAX_COMMAND_LENGTH} caracteres.`);
  }

  return {
    ok: true,
    command
  };
}

/**
 * @param {unknown} payload
 */
export function validateActuatorStatusPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return invalid('INVALID_ACTUATOR_STATUS_PAYLOAD', 'Payload de actuador invalido.');
  }

  const status = payload.status === 'ok' ? 'ok' : 'error';
  const message = extractInputText(payload.message).slice(0, MAX_STATUS_MESSAGE_LENGTH) || 'Sin detalles';

  return {
    ok: true,
    status,
    message
  };
}

function invalid(code, message) {
  return {
    ok: false,
    code,
    message
  };
}
