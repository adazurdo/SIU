import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { VOICE_INTENTS } from './command-contract.js';
import { sendApiError } from './http/api-errors.js';
import { createInitialSystemState, applyVoiceResultToState } from './state/system-state.js';
import { geocodeDestination } from './services/geocode-service.js';
import { calculateRoute, parseLatLonParam } from './services/route-service.js';
import { extractInputText } from './utils/text.js';
import { processVoiceCommand, sanitizeIncomingCommand } from './voice/command-parser.js';
import { createRateLimiter } from './security/rate-limit.js';
import { createCorsMiddleware, createOriginMatcher, parseAllowedOrigins } from './security/cors.js';
import { logEvent } from './observability/logger.js';
import { validateActuatorStatusPayload, validateVoiceCommandPayload } from './voice/payload-validator.js';
import {
  buildActionResultEvent,
  buildActuatorExecEvent,
  buildActuatorStatusAckEvent,
  buildSystemStateEvent
} from './socket/event-contract.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const PORT = 3000;
const EXTERNAL_REQUEST_TIMEOUT_MS = 8000;
const STATE_SCOPE = process.env.SIU_STATE_SCOPE === 'socket' ? 'socket' : 'global';

const allowedOrigins = parseAllowedOrigins(process.env.SIU_ALLOWED_ORIGINS);
const isOriginAllowed = createOriginMatcher(allowedOrigins);

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      callback(null, isOriginAllowed(origin));
    },
    credentials: true
  }
});

const apiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 60
});

app.use(express.static(join(__dirname, '..', 'public')));
app.use(createCorsMiddleware({ allowedOrigins }));

app.get('/api/geocode', apiRateLimiter, async (req, res) => {

  const query = extractInputText(req.query.query);
  const near = parseLatLonParam(extractInputText(req.query.near));

  if (!query) {
    sendApiError(res, {
      status: 400,
      code: 'MISSING_QUERY',
      message: 'Falta el parametro query'
    });
    return;
  }

  try {
    const result = await geocodeDestination(query, {
      timeoutMs: EXTERNAL_REQUEST_TIMEOUT_MS,
      near
    });
    logEvent('info', 'api.geocode.success', {
      query,
      near,
      hasName: Boolean(result.name)
    });
    res.json(result);
  } catch (error) {
    logEvent('warn', 'api.geocode.error', {
      code: readErrorCode(error),
      message: readErrorMessage(error)
    });
    handleServiceError(res, error, {
      GEOCODE_NOT_FOUND: 404,
      GEOCODE_UPSTREAM_UNAVAILABLE: 502,
      GEOCODE_TIMEOUT: 504,
      GEOCODE_UPSTREAM_ERROR: 502,
      GEOCODE_INTERNAL_ERROR: 500
    });
  }
});

app.get('/api/route', apiRateLimiter, async (req, res) => {
  const origin = parseLatLonParam(extractInputText(req.query.origin));
  const destination = parseLatLonParam(extractInputText(req.query.destination));

  if (!origin || !destination) {
    sendApiError(res, {
      status: 400,
      code: 'INVALID_ROUTE_COORDS',
      message: 'Parametros origin/destination invalidos. Formato esperado: lat,lon'
    });
    return;
  }

  try {
    const result = await calculateRoute(origin, destination, { timeoutMs: EXTERNAL_REQUEST_TIMEOUT_MS });
    logEvent('info', 'api.route.success', {
      distance: result.distance,
      steps: Array.isArray(result.steps) ? result.steps.length : 0
    });
    res.json(result);
  } catch (error) {
    logEvent('warn', 'api.route.error', {
      code: readErrorCode(error),
      message: readErrorMessage(error)
    });
    handleServiceError(res, error, {
      ROUTE_NOT_FOUND: 404,
      ROUTE_UPSTREAM_BAD_STATUS: 502,
      ROUTE_TIMEOUT: 504,
      ROUTE_UPSTREAM_ERROR: 502,
      ROUTE_INTERNAL_ERROR: 500
    });
  }
});

const globalSystemState = createInitialSystemState();
const perSocketState = new Map();
let connectedClients = 0;

function getStateForSocket(socketId) {
  if (STATE_SCOPE === 'global') {
    return globalSystemState;
  }

  if (!perSocketState.has(socketId)) {
    perSocketState.set(socketId, createInitialSystemState());
  }

  return perSocketState.get(socketId);
}

function updateConnectedClients(nextCount) {
  connectedClients = nextCount;
  globalSystemState.connectedClients = nextCount;

  for (const state of perSocketState.values()) {
    state.connectedClients = nextCount;
  }
}

function emitState(socket) {
  const state = getStateForSocket(socket.id);
  const payload = buildSystemStateEvent(state);

  if (STATE_SCOPE === 'global') {
    io.emit('system-state', payload);
    return;
  }

  socket.emit('system-state', payload);
}

io.on('connection', (socket) => {
  updateConnectedClients(connectedClients + 1);
  const state = getStateForSocket(socket.id);
  state.connectedClients = connectedClients;

  logEvent('info', 'socket.connection', {
    socketId: socket.id,
    connectedClients,
    stateScope: STATE_SCOPE
  });

  socket.emit('system-state', buildSystemStateEvent(state));

  socket.on('voice-command', (data) => {
    const stateForSocket = getStateForSocket(socket.id);
    const payloadValidation = validateVoiceCommandPayload(data);

    if (!payloadValidation.ok) {
      const invalidResult = buildActionResultEvent({
        action: VOICE_INTENTS.INVALID,
        code: payloadValidation.code,
        message: payloadValidation.message,
        newMode: stateForSocket.mode
      });

      logEvent('warn', 'socket.voice-command.invalid-payload', {
        socketId: socket.id,
        code: payloadValidation.code
      });

      socket.emit('action-result', invalidResult);
      return;
    }

    const incomingCommand = sanitizeIncomingCommand(payloadValidation.command);

    if (!incomingCommand) {
      const invalidResult = buildActionResultEvent({
        action: VOICE_INTENTS.INVALID,
        code: 'INVALID_COMMAND_EMPTY',
        message: 'No se recibio un comando de voz valido.',
        newMode: stateForSocket.mode
      });

      socket.emit('action-result', invalidResult);
      return;
    }

    logEvent('info', 'socket.voice-command.received', {
      socketId: socket.id,
      command: incomingCommand,
      prevMode: stateForSocket.mode
    });

    const parserResult = processVoiceCommand(incomingCommand, stateForSocket.mode);
    logEvent('info', 'socket.voice-command.parsed', {
      socketId: socket.id,
      action: parserResult.action,
      requestedMode: parserResult.newMode || stateForSocket.mode
    });

    const transition = applyVoiceResultToState({
      state: stateForSocket,
      incomingCommand,
      parserResult,
      socketId: socket.id
    });

    const result = transition.effectiveResult;
    const actionResultPayload = buildActionResultEvent(result);

    if (Object.prototype.hasOwnProperty.call(result, 'pendingAction')) {
      if (stateForSocket.pendingAction) {
        logEvent('info', 'state.pending-action.created', {
          socketId: socket.id,
          action: describeAction(stateForSocket.pendingAction)
        });
      } else {
        logEvent('info', 'state.pending-action.cleared', {
          socketId: socket.id
        });
      }
    }

    socket.emit('action-result', actionResultPayload);

    if (result.action === VOICE_INTENTS.CONFIRM && transition.actionToExecute) {
      logEvent('info', 'actuator.execute.confirmed', {
        socketId: socket.id,
        action: describeAction(transition.actionToExecute)
      });
      executeActuator(socket, transition.actionToExecute);
    }

    if (transition.immediateAction) {
      logEvent('info', 'actuator.execute.immediate', {
        socketId: socket.id,
        action: describeAction(transition.immediateAction)
      });
      executeActuator(socket, transition.immediateAction);
    }

    logEvent('info', 'state.updated', {
      socketId: socket.id,
      mode: stateForSocket.mode,
      pending: describeAction(stateForSocket.pendingAction),
      connectedClients
    });

    emitState(socket);
  });

  socket.on('actuator-status', (data) => {
    const statusValidation = validateActuatorStatusPayload(data);

    if (!statusValidation.ok) {
      logEvent('warn', 'actuator.status.invalid-payload', {
        socketId: socket.id,
        code: statusValidation.code
      });
      socket.emit('actuator-status-ack', buildActuatorStatusAckEvent('error', statusValidation.message));
      return;
    }

    const status = statusValidation.status;
    const message = statusValidation.message;

    logEvent(status === 'ok' ? 'info' : 'warn', 'actuator.status.received', {
      socketId: socket.id,
      status,
      message
    });

    socket.emit('actuator-status-ack', buildActuatorStatusAckEvent(status, message));
  });

  socket.on('disconnect', () => {
    if (STATE_SCOPE === 'socket') {
      perSocketState.delete(socket.id);
    }

    updateConnectedClients(Math.max(0, connectedClients - 1));

    logEvent('info', 'socket.disconnection', {
      socketId: socket.id,
      connectedClients,
      stateScope: STATE_SCOPE
    });
  });
});

/**
 * @param {import('socket.io').Socket} socket
 * @param {{ type: string, payload?: object }} action
 */
function executeActuator(socket, action) {
  if (!action || !action.type) return;

  socket.emit('actuator-exec', buildActuatorExecEvent(action));
}

/**
 * @param {{ type?: string, payload?: object } | null} action
 * @returns {string}
 */
function describeAction(action) {
  if (!action || !action.type) return 'none';

  const payloadKeys = action.payload ? Object.keys(action.payload) : [];
  return payloadKeys.length > 0
    ? `${action.type}(${payloadKeys.join(',')})`
    : action.type;
}

/**
 * @param {import('express').Response} res
 * @param {unknown} error
 * @param {Record<string, number>} statusByCode
 */
function handleServiceError(res, error, statusByCode) {
  const code = readErrorCode(error);
  const message = readErrorMessage(error);
  const details = readErrorDetails(error);
  const status = statusByCode[code] || 500;

  sendApiError(res, {
    status,
    code,
    message,
    details
  });
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function readErrorCode(error) {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }

  return 'INTERNAL_ERROR';
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function readErrorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  return 'Error interno no controlado';
}

/**
 * @param {unknown} error
 * @returns {string | undefined}
 */
function readErrorDetails(error) {
  if (error && typeof error === 'object' && 'details' in error && typeof error.details === 'string') {
    return error.details;
  }

  return undefined;
}

server.listen(PORT, () => {
  logEvent('info', 'server.started', {
    port: PORT,
    stateScope: STATE_SCOPE,
    allowedOrigins: Array.from(allowedOrigins)
  });
});
