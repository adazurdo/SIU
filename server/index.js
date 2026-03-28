import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Configuracion del servidor
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server);

const PORT = 3000;

// Servir archivos estaticos desde la carpeta public/
app.use(express.static(join(__dirname, '..', 'public')));

// API: geocodificacion de texto libre a coordenadas
app.get('/api/geocode', async (req, res) => {
  const query = typeof req.query.query === 'string' ? req.query.query.trim() : '';

  if (!query) {
    res.status(400).json({ error: 'Falta el parametro query' });
    return;
  }

  try {
    const geocodeQueries = buildGeocodeCandidates(query);
    let first = null;

    for (const candidate of geocodeQueries) {
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('format', 'json');
      url.searchParams.set('limit', '5');
      url.searchParams.set('q', candidate);

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'MotoNav-SIU/1.0 (educational project)'
        }
      });

      if (!response.ok) continue;

      const data = await response.json();
      const items = Array.isArray(data) ? data : [];
      if (items.length === 0) continue;

      first = selectBestGeocodeMatch(items, query);
      if (first) break;
    }

    if (!first) {
      res.status(404).json({ error: 'No se encontro el destino solicitado' });
      return;
    }

    res.json({
      lat: Number(first.lat),
      lon: Number(first.lon),
      name: first.display_name || query
    });
  } catch {
    res.status(500).json({ error: 'Error interno geocodificando destino' });
  }
});

/**
 * Genera consultas alternativas para mejorar la tasa de acierto del geocoder.
 *
 * @param {string} query
 * @returns {string[]}
 */
function buildGeocodeCandidates(query) {
  const normalized = normalizeForMatching(query)
    .replace(/\s+/g, ' ')
    .trim();

  const candidates = new Set([
    query,
    normalized,
    `${normalized}, madrid, espana`
  ]);

  // Variante UC3M muy habitual en este proyecto
  if (normalized.includes('universidad carlos tercero') || normalized.includes('carlos iii') || normalized.includes('uc3m')) {
    candidates.add('universidad carlos iii de madrid leganes');
    candidates.add('uc3m leganes');
    candidates.add('universidad carlos iii de madrid campus de leganes');
  }

  // Quitar puntuacion intermedia que a veces degrada resultados
  const dePunctuated = normalized.replace(/[,:;.!?]/g, ' ').replace(/\s+/g, ' ').trim();
  if (dePunctuated) {
    candidates.add(dePunctuated);
    candidates.add(`${dePunctuated}, madrid, espana`);
  }

  return Array.from(candidates);
}

/**
 * Selecciona la mejor coincidencia priorizando universidades/colegios y coincidencia textual.
 *
 * @param {Array<any>} items
 * @param {string} originalQuery
 * @returns {any | null}
 */
function selectBestGeocodeMatch(items, originalQuery) {
  if (!Array.isArray(items) || items.length === 0) return null;

  const q = normalizeForMatching(originalQuery);

  const scored = items.map((item) => {
    const name = normalizeForMatching(String(item.display_name || ''));
    let score = 0;

    if (name.includes('universidad') || name.includes('university') || name.includes('college')) score += 3;
    if (q.includes('leganes') && name.includes('leganes')) score += 2;
    if (q.includes('carlos') && name.includes('carlos')) score += 1;
    if (q.includes('tercero') && (name.includes('iii') || name.includes('tercero'))) score += 1;

    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.item || null;
}

// API: ruta con pasos de navegacion usando OSRM
app.get('/api/route', async (req, res) => {
  const origin = parseLatLonParam(typeof req.query.origin === 'string' ? req.query.origin : '');
  const destination = parseLatLonParam(typeof req.query.destination === 'string' ? req.query.destination : '');

  if (!origin || !destination) {
    res.status(400).json({ error: 'Parametros origin/destination invalidos. Formato esperado: lat,lon' });
    return;
  }

  try {
    const routeUrl = new URL(
      `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}`
    );

    routeUrl.searchParams.set('overview', 'false');
    routeUrl.searchParams.set('alternatives', 'false');
    routeUrl.searchParams.set('steps', 'true');

    const response = await fetch(routeUrl);

    if (!response.ok) {
      res.status(502).json({ error: 'No se pudo obtener la ruta' });
      return;
    }

    const data = await response.json();
    const route = data?.routes?.[0];
    const rawSteps = route?.legs?.[0]?.steps || [];

    if (!route || rawSteps.length === 0) {
      res.status(404).json({ error: 'No hay pasos de ruta disponibles para ese destino' });
      return;
    }

    const steps = rawSteps.map((step, index) => ({
      index,
      distance: Number(step.distance || 0),
      duration: Number(step.duration || 0),
      location: {
        lat: Number(step?.maneuver?.location?.[1]),
        lon: Number(step?.maneuver?.location?.[0])
      },
      instruction: buildSpanishInstruction(step)
    }));

    res.json({
      distance: Number(route.distance || 0),
      duration: Number(route.duration || 0),
      steps
    });
  } catch {
    res.status(500).json({ error: 'Error interno calculando ruta' });
  }
});

/**
 * Estado global del sistema
 * 
 * Almacena el estado actual que se comparte entre
 * todos los dispositivos conectados.
 */
const systemState = {
  // 'idle' | 'listening' | 'confirming' | 'navigating'
  mode: 'idle',               
  // Ultimo comando de voz reconocido
  lastCommand: null,        
  // Numero de clientes conectados
  connectedClients: 0,      
  // Accion pendiente de confirmacion
  // { type: string, payload?: object }
  pendingAction: null        
};

// Conexion con Socket.io
io.on('connection', (socket) => {
  systemState.connectedClients++;
  console.log(`[Conexion] Cliente conectado: ${socket.id} (Total: ${systemState.connectedClients})`);

  // Enviar el estado actual al cliente que se acaba de conectar
  socket.emit('system-state', systemState);

  // Evento: comando de voz recibido desde el cliente 
  socket.on('voice-command', (data) => {
    const incomingCommand = sanitizeIncomingCommand(data?.command);

    if (!incomingCommand) {
      socket.emit('action-result', {
        action: 'invalid',
        message: 'No se recibio un comando de voz valido.',
        newMode: systemState.mode
      });
      return;
    }

    console.log(`[Voz] Comando recibido de ${socket.id}: "${incomingCommand}"`);

    const result = processVoiceCommand(incomingCommand);
    console.log(`[Parser] Accion=${result.action} | ModoDestino=${result.newMode || systemState.mode}`);

    // En confirmar, ejecutar primero la accion pendiente actual.
    const actionToExecute = result.action === 'confirm' ? systemState.pendingAction : null;
    const immediateAction = result.executeNow || null;

    if (result.action === 'confirm' && !actionToExecute) {
      result.message = 'No hay ninguna accion pendiente para confirmar.';
      // No forzamos modo idle: mantenemos el estado actual para evitar regresiones por ruido de voz.
      result.newMode = systemState.mode;
      console.log(`[Estado] ${socket.id} confirmo sin accion pendiente`);
    }

    // Actualizar el estado del sistema
    systemState.lastCommand = incomingCommand;
    systemState.mode = result.newMode || systemState.mode;

    if (Object.prototype.hasOwnProperty.call(result, 'pendingAction')) {
      systemState.pendingAction = result.pendingAction;

      if (systemState.pendingAction) {
        console.log(`[Estado] Accion pendiente creada -> ${describeAction(systemState.pendingAction)}`);
      } else {
        console.log('[Estado] Accion pendiente limpiada');
      }
    }

    // Enviar resultado al cliente que envio el comando
    socket.emit('action-result', result);

    // Ejecutar actuador en el cliente que confirmo la accion
    if (result.action === 'confirm' && actionToExecute) {
      console.log(`[Actuador] Ejecutando por confirmacion -> ${describeAction(actionToExecute)}`);
      executeActuator(socket, actionToExecute);
    }

    // Ejecutar actuadores inmediatos (por ejemplo, "repetir")
    if (immediateAction) {
      console.log(`[Actuador] Ejecutando inmediato -> ${describeAction(immediateAction)}`);
      executeActuator(socket, immediateAction);
    }

    console.log(
      `[Estado] mode=${systemState.mode} | pending=${describeAction(systemState.pendingAction)} | clients=${systemState.connectedClients}`
    );

    // Sincronizar estado con todos los clientes conectados
    io.emit('system-state', systemState);
  });

  // Resultado de ejecucion de actuadores desde el cliente
  socket.on('actuator-status', (data) => {
    const status = data?.status === 'ok' ? 'OK' : 'ERROR';
    const message = data?.message || 'Sin detalles';
    console.log(`[Actuador][${status}] ${socket.id}: ${message}`);
  });

  // Evento: desconexion
  socket.on('disconnect', () => {
    systemState.connectedClients--;
    console.log(`[Desconexion] Cliente desconectado: ${socket.id} (Total: ${systemState.connectedClients})`);
  });
});

// Procesamiento de comandos de voz

/**
 * Procesa un comando de voz y determina la accion a realizar.
 * 
 * Los comandos soportados estan basados en el diseno de la Idea A del proyecto:
 * comandos cortos que no requieren apartar la vista de la carretera.
 * 
 * @param {string} command - El texto del comando reconocido
 * @returns {object} - Resultado con la accion, mensaje y nuevo modo del sistema
 */
function processVoiceCommand(command) {
  const normalizedCommand = normalizeForMatching(command);

  // Comando: indicaciones hacia un destino libre
  const destination = extractDestinationFromCommand(normalizedCommand);
  if (destination) {
    return {
      action: 'navigate_to_destination',
      message: `Iniciando navegacion por voz hacia "${destination}"...`,
      newMode: 'navigating',
      pendingAction: null,
      executeNow: {
        type: 'start_voice_navigation',
        payload: {
          destination
        }
      }
    };
  }

  // Comando: buscar gasolinera
  if (normalizedCommand.includes('buscar gasolinera') || normalizedCommand.includes('gasolinera')) {
    return {
      action: 'search_gas_station',
      message: 'Iniciando navegacion por voz a gasolinera cercana...',
      newMode: 'navigating',
      pendingAction: null,
      executeNow: {
        type: 'start_voice_navigation',
        payload: {
          destination: 'gasolinera cerca de mi'
        }
      }
    };
  }

  // Comando: llamar a alguien
  if (normalizedCommand.includes('llamar a') || normalizedCommand.includes('llama a')) {
    const contactName = normalizedCommand.replace(/llamar a|llama a/g, '').trim();
    return {
      action: 'call_contact',
      message: `Llamada detectada a "${contactName}". Di "confirmar" para ejecutar.`,
      newMode: 'confirming',
      pendingAction: {
        type: 'call_contact',
        payload: {
          contactName
        }
      }
    };
  }

  // Comando: cancelar accion actual
  if (hasAnyWord(normalizedCommand, ['cancelar', 'cancel'])) {
    return {
      action: 'cancel',
      message: 'Accion cancelada.',
      newMode: 'idle',
      pendingAction: null,
      executeNow: {
        type: 'stop_voice_navigation',
        payload: {}
      }
    };
  }

  // Comando: confirmar accion pendiente
  if (isStrictConfirmation(normalizedCommand)) {
    return {
      action: 'confirm',
      message: 'Accion confirmada. Ejecutando actuador...',
      newMode: 'navigating',
      pendingAction: null
    };
  }

  // Comando: repetir ultima indicacion
  if (hasAnyWord(normalizedCommand, ['repetir'])) {
    return {
      action: 'repeat',
      message: 'Repitiendo ultima indicacion...',
      newMode: systemState.mode,
      executeNow: {
        type: 'repeat_last_message',
        payload: {}
      }
    };
  }

  // Comando no reconocido
  return {
    action: 'unknown',
    message: `Comando no reconocido: "${command}"`,
    newMode: systemState.mode
  };
}

/**
 * Limpia y valida el comando recibido por socket.
 *
 * @param {unknown} command
 * @returns {string|null}
 */
function sanitizeIncomingCommand(command) {
  if (typeof command !== 'string') return null;

  const trimmed = command.trim();
  if (trimmed.length === 0) return null;

  // Limpiar muletillas frecuentes al inicio del dictado: "e,", "eh,", "y,", etc.
  const withoutFiller = trimmed.replace(/^(?:e+|eh+|em+|mmm+|y)\s*[,;:.!?-]*\s*/i, '').trim();
  return withoutFiller.length > 0 ? withoutFiller : null;
}

/**
 * Normaliza texto para comparaciones de comandos.
 * Convierte a minusculas y elimina diacriticos (tildes).
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeForMatching(text) {
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
function hasAnyWord(text, words) {
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(^|\\s|[.,;:!?¡¿])(?:${escaped.join('|')})(?=$|\\s|[.,;:!?¡¿])`, 'i');
  return pattern.test(text);
}

/**
 * Reconoce confirmaciones cortas y explicitas.
 * Evita falsos positivos por frases largas que contienen "si".
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

    if (cleaned.length > 0) {
      return cleaned;
    }
  }

  return null;
}

/**
 * Envia al cliente una instruccion de actuador para su ejecucion local.
 *
 * @param {import('socket.io').Socket} socket
 * @param {{ type: string, payload?: object }} action
 */
function executeActuator(socket, action) {
  if (!action || !action.type) return;

  socket.emit('actuator-exec', {
    type: action.type,
    payload: action.payload || {}
  });
}

/**
 * Devuelve una descripcion compacta de una accion para logs.
 *
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
 * Convierte un parametro "lat,lon" a objeto numerico validado.
 *
 * @param {string} raw
 * @returns {{lat: number, lon: number} | null}
 */
function parseLatLonParam(raw) {
  const [latRaw, lonRaw] = String(raw).split(',');
  const lat = Number(latRaw);
  const lon = Number(lonRaw);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  return { lat, lon };
}

/**
 * Genera una instruccion en espanol a partir de un paso OSRM.
 *
 * @param {any} step
 * @returns {string}
 */
function buildSpanishInstruction(step) {
  const maneuver = step?.maneuver || {};
  const type = String(maneuver.type || 'continue');
  const modifier = String(maneuver.modifier || '');
  const name = String(step?.name || '').trim();
  const onRoad = name ? ` por ${name}` : '';

  if (type === 'depart') return `Empieza la ruta${onRoad}.`;
  if (type === 'arrive') return 'Has llegado a tu destino.';
  if (type === 'turn') return `Gira ${translateModifier(modifier)}${onRoad}.`;
  if (type === 'continue') return `Continua recto${onRoad}.`;
  if (type === 'new name') return `Continua${onRoad}.`;
  if (type === 'merge') return `Incorporate${onRoad}.`;
  if (type === 'on ramp') return `Toma la rampa${onRoad}.`;
  if (type === 'off ramp') return `Toma la salida${onRoad}.`;
  if (type === 'fork') return `En la bifurcacion, ve ${translateModifier(modifier)}${onRoad}.`;

  if (type === 'roundabout' || type === 'rotary') {
    const exit = Number(maneuver.exit || 0);
    if (Number.isFinite(exit) && exit > 0) {
      return `En la rotonda, toma la salida ${exit}${onRoad}.`;
    }
    return `En la rotonda, continua${onRoad}.`;
  }

  return `Sigue${onRoad}.`;
}

/**
 * Traduce modificadores de direccion OSRM.
 *
 * @param {string} modifier
 * @returns {string}
 */
function translateModifier(modifier) {
  switch (modifier) {
    case 'left':
      return 'a la izquierda';
    case 'right':
      return 'a la derecha';
    case 'slight left':
      return 'ligeramente a la izquierda';
    case 'slight right':
      return 'ligeramente a la derecha';
    case 'sharp left':
      return 'de forma pronunciada a la izquierda';
    case 'sharp right':
      return 'de forma pronunciada a la derecha';
    case 'uturn':
      return 'en U';
    case 'straight':
    default:
      return 'recto';
  }
}

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`Servidor inicializado -> http://localhost:${PORT}`);
});
