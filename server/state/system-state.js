import { resolveModeTransition, SYSTEM_MODES, VOICE_INTENTS } from '../command-contract.js';

/**
 * @returns {{
 *   mode: string,
 *   lastCommand: string | null,
 *   connectedClients: number,
 *   pendingAction: any,
 *   lastResult: any,
 *   devices: Array<any>
 * }}
 */
export function createInitialSystemState() {
  return {
    mode: SYSTEM_MODES.IDLE,
    lastCommand: null,
    connectedClients: 0,
    pendingAction: null,
    lastResult: null,
    devices: []
  };
}

/**
 * Aplica el resultado del parser al estado global del sistema.
 *
 * @param {{
 *   state: {
 *     mode: string,
 *     lastCommand: string | null,
 *     connectedClients: number,
 *     pendingAction: any,
 *     lastResult: any,
 *     devices: Array<any>
 *   },
 *   incomingCommand: string,
 *   parserResult: any,
 *   socketId: string
 * }} input
 * @returns {{state: any, effectiveResult: any, actionToExecute: any, immediateAction: any}}
 */
export function applyVoiceResultToState(input) {
  const { state, incomingCommand, parserResult, socketId } = input;
  const effectiveResult = { ...parserResult };

  const actionToExecute = effectiveResult.action === VOICE_INTENTS.CONFIRM ? state.pendingAction : null;
  const immediateAction = effectiveResult.executeNow || null;

  if (effectiveResult.action === VOICE_INTENTS.CONFIRM && !actionToExecute) {
    effectiveResult.message = 'No hay ninguna accion pendiente para confirmar.';
    effectiveResult.newMode = state.mode;
    console.log(`[Estado] ${socketId} confirmo sin accion pendiente`);
  }

  state.lastCommand = incomingCommand;
  state.mode = resolveModeTransition(state.mode, effectiveResult.newMode);
  state.lastResult = {
    action: effectiveResult.action,
    code: effectiveResult.code || null,
    message: effectiveResult.message,
    mode: state.mode,
    at: new Date().toISOString()
  };

  if (Object.prototype.hasOwnProperty.call(effectiveResult, 'pendingAction')) {
    state.pendingAction = effectiveResult.pendingAction;
  }

  return {
    state,
    effectiveResult,
    actionToExecute,
    immediateAction
  };
}
