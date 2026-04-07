import { VOICE_INTENTS } from '../command-contract.js';

/**
 * @param {{
 *   mode: string,
 *   lastCommand: string | null,
 *   connectedClients: number,
 *   pendingAction: any,
 *   lastResult?: any,
 *   devices?: Array<any>
 * }} state
 */
export function buildSystemStateEvent(state) {
  return {
    ok: true,
    event: 'system-state',
    data: {
      mode: state.mode,
      lastCommand: state.lastCommand,
      connectedClients: state.connectedClients,
      pendingAction: state.pendingAction || null,
      lastResult: state.lastResult || null,
      devices: Array.isArray(state.devices) ? state.devices : []
    },
    // Compatibilidad con frontend actual
    mode: state.mode,
    lastCommand: state.lastCommand,
    connectedClients: state.connectedClients,
    pendingAction: state.pendingAction || null,
    lastResult: state.lastResult || null,
    devices: Array.isArray(state.devices) ? state.devices : []
  };
}

/**
 * @param {{action: string, message: string, newMode: string, pendingAction?: any, executeNow?: any, code?: string}} result
 */
export function buildActionResultEvent(result) {
  const ok = result.action !== VOICE_INTENTS.INVALID && result.action !== VOICE_INTENTS.UNKNOWN;

  return {
    ok,
    event: 'action-result',
    code: result.code || null,
    data: { ...result },
    // Compatibilidad con frontend actual
    ...result
  };
}

/**
 * @param {{ type: string, payload?: object }} action
 */
export function buildActuatorExecEvent(action) {
  return {
    ok: true,
    event: 'actuator-exec',
    data: {
      type: action.type,
      payload: action.payload || {}
    },
    // Compatibilidad con frontend actual
    type: action.type,
    payload: action.payload || {}
  };
}

/**
 * @param {'ok' | 'error'} status
 * @param {string} message
 */
export function buildActuatorStatusAckEvent(status, message) {
  return {
    ok: status === 'ok',
    event: 'actuator-status-ack',
    code: status === 'ok' ? 'ACTUATOR_STATUS_OK' : 'ACTUATOR_STATUS_ERROR',
    message,
    data: {
      status,
      message
    },
    // Compatibilidad por si algun cliente lee plano
    status,
    message
  };
}
