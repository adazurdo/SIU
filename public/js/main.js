/**
 * main.js - Modulo principal del cliente 
 *
 * Coordina la conexion con el servidor via Socket.IO y el modulo de
 * interaccion por voz. Actua como punto central que:
 *   1. Conecta con el servidor Socket.IO
 *   2. Inicializa el modulo de voz (voice.js)
 *   3. Envia los comandos detectados al servidor
 *   4. Recibe las respuestas del servidor y actualiza la interfaz
 */

import { VoiceController } from './voice.js';

// Conexion con el servidor Socket.IO 

const socket = io();

// Referencias a los elementos del DOM / Interfaz

const connectionValue = document.getElementById('connection-value');
const modeValue = document.getElementById('mode-value');
const voiceToggle = document.getElementById('voice-toggle');
const voiceStatusValue = document.getElementById('voice-status-value');
const lastCommandEl = document.getElementById('last-command');
const actionLog = document.getElementById('action-log');

// Ultimo mensaje del sistema para soporte del comando "repetir"
let lastSystemMessage = '';

// Estado de la navegacion por voz interna
const voiceNavigationState = {
  active: false,
  watchId: null,
  destination: '',
  steps: [],
  nextStepIndex: 0,
  announcedApproachIndex: -1
};

// Inicializacion del controlador de voz 

const voiceController = new VoiceController({
  /**
   * Callback que se ejecuta cuando se reconoce un comando de voz.
   * Envia el comando al servidor a traves de Socket.IO.
   */
  onCommand: (command) => {
    lastCommandEl.textContent = command;
    socket.emit('voice-command', { command });
    addLogEntry(`Comando de voz: "${command}"`, 'voice');
  },

  /**
   * Callback que se ejecuta cuando cambia el estado del reconocimiento de voz.
   * Actualiza la interfaz para reflejar el estado actual.
   */
  onStatusChange: (status) => {
    const statusMessages = {
      'listening': 'Escuchando... (di "Hey MotoNav")',
      'awake': 'Escuchando! Di tu comando.',
      'sleeping': 'Escuchando... (di "Hey MotoNav")',
      'command-received': 'Comando recibido',
      'stopped': 'Inactivo',
      'error': 'Error en el reconocimiento',
      'no-support': 'Navegador no soportado'
    };

    voiceStatusValue.textContent = statusMessages[status] || status;
  }
});

// Eventos de Socket.IO 

/** Evento: conexion establecida con el servidor */
socket.on('connect', () => {
  connectionValue.textContent = 'Conectado';
  connectionValue.className = 'value connected';
  addLogEntry('Conectado al servidor', 'system');
});

/** Evento: desconexion del servidor */
socket.on('disconnect', () => {
  connectionValue.textContent = 'Desconectado';
  connectionValue.className = 'value disconnected';
  addLogEntry('Desconectado del servidor', 'system');
});

/** Evento: el servidor envia una actualizacion del estado del sistema */
socket.on('system-state', (state) => {
  modeValue.textContent = state.mode;
});

/** Evento: el servidor envia el resultado de una accion procesada */
socket.on('action-result', (result) => {
  addLogEntry(result.message, 'system');
  lastSystemMessage = result.message;
});

/** Evento: el servidor ordena ejecutar un actuador en el cliente */
socket.on('actuator-exec', async (instruction) => {
  try {
    await runActuator(instruction);
    reportActuatorStatus('ok', `Actuador ejecutado: ${instruction?.type || 'desconocido'}`);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    addLogEntry(`Error al ejecutar actuador: ${details}`, 'system');
    reportActuatorStatus('error', `Fallo en ${instruction?.type || 'desconocido'}: ${details}`);
  }
});

// Botones de la interfaz

/** Boton para activar/desactivar el reconocimiento de voz */
voiceToggle.addEventListener('click', () => {
  if (voiceController.isActive) {
    voiceController.stop();
    voiceToggle.textContent = 'Activar microfono';
    voiceToggle.classList.remove('active');
  } else {
    voiceController.start();
    voiceToggle.textContent = 'Desactivar microfono';
    voiceToggle.classList.add('active');
  }
});

// Funciones auxiliares 

/**
 * Anade una entrada al log de acciones en la interfaz.
 * 
 * Cada entrada incluye una marca de tiempo y un tipo (voice, system)
 * que determina el color del texto.
 * 
 * @param {string} message - Mensaje a mostrar en el log
 * @param {string} type - Tipo de entrada: 'voice' o 'system'
 */
function addLogEntry(message, type = 'system') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;

  const timestamp = new Date().toLocaleTimeString('es-ES');
  entry.innerHTML = `<span class="timestamp">[${timestamp}]</span> ${message}`;

  // Insertar al principio para que las mas recientes se vean arriba
  actionLog.insertBefore(entry, actionLog.firstChild);

  // Limitar el numero de entradas en el log
  while (actionLog.children.length > 50) {
    actionLog.removeChild(actionLog.lastChild);
  }
}

/**
 * Ejecuta el actuador recibido desde el servidor.
 *
 * @param {{ type?: string, payload?: object }} instruction
 */
async function runActuator(instruction) {
  const type = instruction?.type;
  const payload = instruction?.payload || {};

  switch (type) {
    case 'start_voice_navigation': {
      const destination = String(payload.destination || '').trim();

      if (!destination) {
        throw new Error('No se detecto un destino para iniciar navegacion por voz.');
      }

      await startVoiceNavigation(destination);
      break;
    }

    case 'stop_voice_navigation': {
      stopVoiceNavigation(true);
      break;
    }

    case 'navigate_google_maps_directions': {
      const destination = String(payload.destination || '').trim();

      if (!destination) {
        throw new Error('No se detecto un destino para calcular la ruta.');
      }

      await startVoiceNavigation(destination);
      break;
    }

    case 'navigate_google_maps': {
      const query = String(payload.query || 'gasolinera cerca de mi').trim();
      await startVoiceNavigation(query);
      break;
    }

    case 'call_contact': {
      const contactName = String(payload.contactName || '').trim();
      const digits = extractDialDigits(contactName);

      if (!digits) {
        throw new Error(`No hay numero disponible para "${contactName || 'contacto'}".`);
      }

      const callUrl = `tel:${digits}`;
      window.location.href = callUrl;
      addLogEntry(`Intentando llamar al numero ${digits}`, 'system');
      break;
    }

    case 'repeat_last_message': {
      const text = lastSystemMessage || 'No hay ninguna indicacion anterior para repetir.';
      speak(text);
      addLogEntry(`Repetir: ${text}`, 'system');
      break;
    }

    default:
      throw new Error(`Actuador no soportado: ${type || 'sin tipo'}`);
  }
}

/**
 * Inicia una navegacion por voz propia usando geocodificacion + ruta.
 * Si falla, abre Google Maps como fallback para no bloquear al usuario.
 *
 * @param {string} destination
 */
async function startVoiceNavigation(destination) {
  stopVoiceNavigation(false);

  try {
    const originInfo = await getCurrentOrigin();
    const origin = originInfo.origin;

    if (!origin) {
      const reason = originInfo.error ? ` Motivo: ${originInfo.error}` : '';
      addLogEntry(`No tengo acceso a tu ubicacion.${reason} No puedo iniciar navegacion por voz.`, 'system');
      speak('No tengo acceso fiable a tu ubicacion. No puedo iniciar la navegacion por voz.');
      return;
    }

    const geocode = await fetchJson(`/api/geocode?query=${encodeURIComponent(destination)}`);
    const destinationCoord = `${geocode.lat},${geocode.lon}`;
    const route = await fetchJson(
      `/api/route?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destinationCoord)}`
    );

    const steps = Array.isArray(route.steps)
      ? route.steps.filter((step) => Number.isFinite(step?.location?.lat) && Number.isFinite(step?.location?.lon))
      : [];

    if (steps.length === 0) {
      throw new Error('La ruta no contiene pasos navegables.');
    }

    const firstStepIndex = Math.min(getFirstNavigableStepIndex(steps), steps.length - 1);

    voiceNavigationState.active = true;
    voiceNavigationState.destination = geocode.name || destination;
    voiceNavigationState.steps = steps;
    voiceNavigationState.nextStepIndex = firstStepIndex;
    voiceNavigationState.announcedApproachIndex = -1;

    const distanceKm = Number(route.distance || 0) / 1000;
    const distanceText = Number.isFinite(distanceKm) && distanceKm > 0
      ? `${distanceKm.toFixed(1)} kilometros`
      : 'distancia no disponible';

    const firstInstruction = steps[firstStepIndex]?.instruction || 'Comienza la ruta.';
    const destinationName = simplifyDestinationName(voiceNavigationState.destination);

    addLogEntry(`Navegacion por voz iniciada hacia: ${destinationName}`, 'system');
    speak(`Ruta iniciada hacia ${destinationName}. Distancia aproximada ${distanceText}.`);
    speak(`Primera indicacion: ${firstInstruction}`);

    voiceNavigationState.watchId = navigator.geolocation.watchPosition(
      handleNavigationPosition,
      handleNavigationWatchError,
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 3000
      }
    );
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    addLogEntry(`No pude iniciar navegacion por voz interna: ${details}`, 'system');
    speak('No pude iniciar la navegacion por voz interna.');
  }
}

/**
 * Detiene la navegacion por voz actual y limpia estado interno.
 *
 * @param {boolean} announce
 */
function stopVoiceNavigation(announce = false) {
  if (voiceNavigationState.watchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(voiceNavigationState.watchId);
  }

  const wasActive = voiceNavigationState.active;

  voiceNavigationState.active = false;
  voiceNavigationState.watchId = null;
  voiceNavigationState.destination = '';
  voiceNavigationState.steps = [];
  voiceNavigationState.nextStepIndex = 0;
  voiceNavigationState.announcedApproachIndex = -1;

  if (announce && wasActive) {
    addLogEntry('Navegacion por voz detenida.', 'system');
    speak('Navegacion por voz detenida.');
  }
}

/**
 * Gestiona cada actualizacion de posicion durante la navegacion por voz.
 *
 * @param {GeolocationPosition} position
 */
function handleNavigationPosition(position) {
  if (!voiceNavigationState.active) return;

  const currentStep = voiceNavigationState.steps[voiceNavigationState.nextStepIndex];

  if (!currentStep) {
    completeVoiceNavigation();
    return;
  }

  const currentLat = Number(position.coords.latitude);
  const currentLon = Number(position.coords.longitude);

  const distanceToStep = distanceInMeters(
    currentLat,
    currentLon,
    Number(currentStep.location.lat),
    Number(currentStep.location.lon)
  );

  // Aviso anticipado de la siguiente maniobra
  if (distanceToStep <= 120 && voiceNavigationState.announcedApproachIndex !== voiceNavigationState.nextStepIndex) {
    speak(`En aproximadamente ${Math.max(20, Math.round(distanceToStep))} metros, ${currentStep.instruction}`);
    addLogEntry(`Proxima maniobra: ${currentStep.instruction}`, 'system');
    voiceNavigationState.announcedApproachIndex = voiceNavigationState.nextStepIndex;
  }

  // Consideramos el paso completado al acercarnos lo suficiente al punto de maniobra
  if (distanceToStep <= 25) {
    voiceNavigationState.nextStepIndex += 1;
    voiceNavigationState.announcedApproachIndex = -1;

    const nextStep = voiceNavigationState.steps[voiceNavigationState.nextStepIndex];

    if (!nextStep) {
      completeVoiceNavigation();
      return;
    }

    speak(`Ahora: ${nextStep.instruction}`);
    addLogEntry(`Siguiente paso: ${nextStep.instruction}`, 'system');
  }
}

/**
 * Maneja errores del seguimiento GPS en navegacion por voz.
 */
function handleNavigationWatchError() {
  addLogEntry('Se perdio el seguimiento de ubicacion durante la navegacion.', 'system');
  speak('He perdido tu ubicacion temporalmente.');
}

/**
 * Marca la navegacion como completada y anuncia llegada.
 */
function completeVoiceNavigation() {
  const destination = simplifyDestinationName(voiceNavigationState.destination || 'el destino');
  stopVoiceNavigation(false);
  addLogEntry(`Llegada estimada a ${destination}.`, 'system');
  speak(`Has llegado a ${destination}.`);
}

/**
 * Realiza fetch de JSON y lanza error si la respuesta no es valida.
 *
 * @param {string} url
 * @returns {Promise<any>}
 */
async function fetchJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error || `Error HTTP ${response.status}`);
  }

  return data;
}

/**
 * Busca el primer paso util para comenzar a guiar (salta "Empieza la ruta" si aplica).
 *
 * @param {Array<{instruction?: string}>} steps
 * @returns {number}
 */
function getFirstNavigableStepIndex(steps) {
  const idx = steps.findIndex((step) => {
    const text = String(step?.instruction || '').toLowerCase();
    return text && !text.startsWith('empieza la ruta');
  });

  return idx >= 0 ? idx : 0;
}

/**
 * Distancia aproximada entre dos coordenadas usando formula de Haversine.
 *
 * @returns {number} metros
 */
function distanceInMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadius = 6371000;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

/**
 * Acorta nombres largos de destino para que suenen mejor en TTS.
 *
 * @param {string} name
 * @returns {string}
 */
function simplifyDestinationName(name) {
  const clean = String(name || '').replace(/\s+/g, ' ').trim();
  return clean.length > 80 ? `${clean.slice(0, 77)}...` : clean;
}

/**
 * Intenta obtener el origen actual del usuario via Geolocation API.
 * Si falla, devuelve el motivo para facilitar diagnostico.
 *
 * @returns {Promise<{origin: string|null, error: string|null}>}
 */
async function getCurrentOrigin() {
  if (!navigator.geolocation) {
    return { origin: null, error: 'Geolocalizacion no soportada por este navegador.' };
  }

  try {
    // Primer intento: alta precision
    let position = await getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 3000
    });

    const { latitude, longitude } = position.coords;
    return { origin: `${latitude},${longitude}`, error: null };
  } catch (firstError) {
    try {
      // Reintento: menos exigente y con timeout mayor
      const position = await getCurrentPosition({
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 30000
      });

      const { latitude, longitude } = position.coords;
      return { origin: `${latitude},${longitude}`, error: null };
    } catch (secondError) {
      const detailed = formatGeolocationError(secondError || firstError);
      return { origin: null, error: detailed };
    }
  }
}

/**
 * Traduce un error de Geolocation API a un mensaje legible.
 *
 * @param {unknown} err
 * @returns {string}
 */
function formatGeolocationError(err) {
  const code = typeof err === 'object' && err !== null && 'code' in err ? Number(err.code) : NaN;

  if (code === 1) return 'Permiso de ubicacion denegado en navegador o sistema operativo.';
  if (code === 2) return 'Ubicacion no disponible (sin señal o servicio de localizacion).';
  if (code === 3) return 'Tiempo de espera agotado al obtener ubicacion.';

  const message = typeof err === 'object' && err !== null && 'message' in err ? String(err.message) : '';
  return message || 'Error desconocido de geolocalizacion.';
}

/**
 * Wrapper en promesa para navigator.geolocation.getCurrentPosition.
 *
 * @param {PositionOptions} options
 * @returns {Promise<GeolocationPosition>}
 */
function getCurrentPosition(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

/**
 * Reporta al servidor el resultado de ejecucion del actuador.
 *
 * @param {'ok'|'error'} status
 * @param {string} message
 */
function reportActuatorStatus(status, message) {
  socket.emit('actuator-status', { status, message });
}

/**
 * Extrae digitos a marcar desde texto libre o numero dictado en espanol.
 *
 * @param {string} input
 * @returns {string}
 */
function extractDialDigits(input) {
  const rawDigits = String(input || '').replace(/\D/g, '');
  if (rawDigits) return rawDigits;

  const normalized = normalizeForNumberParsing(input);
  const tokens = normalized.split(' ').filter(Boolean);

  const spokenDigits = {
    cero: '0',
    uno: '1',
    un: '1',
    una: '1',
    dos: '2',
    tres: '3',
    cuatro: '4',
    cinco: '5',
    seis: '6',
    siete: '7',
    ocho: '8',
    nueve: '9'
  };

  const digits = [];
  for (const token of tokens) {
    if (spokenDigits[token]) {
      digits.push(spokenDigits[token]);
    }
  }

  return digits.join('');
}

/**
 * @param {string} text
 * @returns {string}
 */
function normalizeForNumberParsing(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Reproduce texto usando SpeechSynthesis cuando esta disponible.
 *
 * @param {string} text
 * @param {{ interrupt?: boolean }} options
 */
function speak(text, options = {}) {
  const synth = window.speechSynthesis;

  if (!synth) {
    throw new Error('SpeechSynthesis no esta disponible en este navegador.');
  }

  if (options.interrupt) {
    synth.cancel();
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'es-ES';
  synth.speak(utterance);
}
