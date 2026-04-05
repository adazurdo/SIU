import { resolveModeTransition, SYSTEM_MODES, VOICE_INTENTS } from '../command-contract.js';

/**
 * @returns {{mode: string, lastCommand: string | null, connectedClients: number, pendingAction: any}}
 */
export function createInitialSystemState() {
  return {
    mode: SYSTEM_MODES.IDLE,
    lastCommand: null,
    connectedClients: 0,
    pendingAction: null
  };
}

/**
 * Aplica el resultado del parser al estado global del sistema.
 *
 * @param {{
 *   state: {mode: string, lastCommand: string | null, connectedClients: number, pendingAction: any},
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
