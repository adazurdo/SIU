/**
 * main.js - Módulo principal del cliente MotoNav HUD
 *
 * Coordina la conexión con el servidor via Socket.IO, el módulo de
 * interacción por voz, el módulo de gestos y el renderizado del HUD.
 *
 * Actúa como punto central que:
 *   1. Conecta con el servidor Socket.IO
 *   2. Inicializa el módulo de voz (voice.js)
 *   3. Inicializa el módulo de gestos (gestures.js)
 *   4. Envia los comandos detectados al servidor
 *   5. Recibe las respuestas del servidor y actualiza el HUD
 */

import { VoiceController } from './voice.js';
import { GestureController } from './gestures.js';
import {
  showUserBubble,
  showSystemBubble,
  showNavigationBanner,
  updateNavigationInstruction,
  hideNavigationBanner,
  showConfirmationPrompt,
  hideConfirmationPrompt,
  updateStatusBadge,
  setMicrophoneActive,
  setCameraActive,
  setConnectionStatus,
  showVoiceStatus,
  hideVoiceStatus
} from './hud-renderer.js';

// ─── Conexión con el servidor Socket.IO ─────────────────────

const socket = io();

// ─── Referencias a elementos del DOM ────────────────────────

const micToggle = document.getElementById('mic-toggle');
const cameraToggle = document.getElementById('camera-toggle');
const gestureVideo = document.getElementById('gesture-video');

// ─── Estado interno ─────────────────────────────────────────

let lastSystemMessage = '';
let currentMode = 'idle';

const voiceNavigationState = {
  active: false,
  watchId: null,
  destination: '',
  steps: [],
  nextStepIndex: 0,
  announcedApproachIndex: -1
};

// ─── Inicialización del controlador de voz ──────────────────

const voiceController = new VoiceController({
  onCommand: (command) => {
    showUserBubble(command);
    socket.emit('voice-command', { command });
  },

  onStatusChange: (status) => {
    const statusMessages = {
      'listening': 'Escuchando… (di "Hey MotoNav")',
      'awake': '¡Escuchando! Di tu comando.',
      'sleeping': 'Escuchando… (di "Hey MotoNav")',
      'command-received': 'Comando recibido',
      'stopped': 'Inactivo',
      'error': 'Error en el reconocimiento',
      'no-support': 'Navegador no soportado'
    };

    const message = statusMessages[status] || status;

    if (status === 'awake' || status === 'command-received') {
      showVoiceStatus(message);

      if (status === 'command-received') {
        setTimeout(hideVoiceStatus, 2000);
      }
    } else if (status === 'listening' || status === 'sleeping') {
      showVoiceStatus(message);
    } else if (status === 'stopped') {
      hideVoiceStatus();
    }
  }
});

// ─── Inicialización del controlador de gestos ───────────────

const gestureController = new GestureController({
  onNod: () => {
    showUserBubble('👍 Asentimiento detectado');
    socket.emit('voice-command', { command: 'confirmar' });
  },

  onShake: () => {
    showUserBubble('👎 Negación detectada');
    socket.emit('voice-command', { command: 'cancelar' });
  },

  onStatusChange: (status) => {
    if (status === 'active') {
      setCameraActive(true);
      showSystemBubble('Cámara de gestos activada. Asiente o niega con la cabeza.');
    } else if (status === 'inactive') {
      setCameraActive(false);
    } else if (status === 'loading') {
      showSystemBubble('Inicializando detección de gestos…');
    } else if (status === 'error') {
      setCameraActive(false);
      showSystemBubble('Error al iniciar la cámara de gestos.');
    }
  }
});

// ─── Eventos de Socket.IO ───────────────────────────────────

socket.on('connect', () => {
  setConnectionStatus(true);
});

socket.on('disconnect', () => {
  setConnectionStatus(false);
});

socket.on('system-state', (state) => {
  currentMode = state.mode;
  updateStatusBadge(state.mode);

  if (state.mode === 'confirming' && state.pendingAction) {
    const actionDescriptions = {
      'call_contact': `¿Quieres llamar a ${state.pendingAction.payload?.contactName || 'contacto'}?`,
      'start_voice_navigation': `¿Navegar hacia ${state.pendingAction.payload?.destination || 'destino'}?`,
      'navigate_google_maps_directions': `¿Abrir ruta hacia ${state.pendingAction.payload?.destination || 'destino'}?`,
      'navigate_google_maps': `¿Buscar ${state.pendingAction.payload?.query || 'ubicación'}?`
    };

    const description = actionDescriptions[state.pendingAction.type]
      || `¿Ejecutar ${state.pendingAction.type}?`;

    showConfirmationPrompt(description);
  } else {
    hideConfirmationPrompt();
  }
});

socket.on('action-result', (result) => {
  showSystemBubble(result.message);
  lastSystemMessage = result.message;
});

socket.on('actuator-exec', async (instruction) => {
  try {
    await runActuator(instruction);
    reportActuatorStatus('ok', `Actuador ejecutado: ${instruction?.type || 'desconocido'}`);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    showSystemBubble(`Error: ${details}`);
    reportActuatorStatus('error', `Fallo en ${instruction?.type || 'desconocido'}: ${details}`);
  }
});

// ─── Botones de la interfaz ─────────────────────────────────

micToggle.addEventListener('click', () => {
  if (voiceController.isActive) {
    voiceController.stop();
    setMicrophoneActive(false);
  } else {
    voiceController.start();
    setMicrophoneActive(true);
  }
});

cameraToggle.addEventListener('click', () => {
  if (gestureController.isActive) {
    gestureController.stop();
  } else {
    gestureController.start(gestureVideo);
  }
});

// ─── Funciones de actuadores ────────────────────────────────

/**
 * Ejecuta el actuador recibido desde el servidor.
 * @param {{ type?: string, payload?: object }} instruction
 */
async function runActuator(instruction) {
  const type = instruction?.type;
  const payload = instruction?.payload || {};

  switch (type) {
    case 'start_voice_navigation': {
      const destination = String(payload.destination || '').trim();
      if (!destination) {
        throw new Error('No se detectó un destino para iniciar navegación por voz.');
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
        throw new Error('No se detectó un destino para calcular la ruta.');
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
        throw new Error(`No hay número disponible para "${contactName || 'contacto'}".`);
      }

      const callUrl = `tel:${digits}`;
      window.location.href = callUrl;
      showSystemBubble(`Llamando al número ${digits}…`);
      break;
    }

    case 'repeat_last_message': {
      const text = lastSystemMessage || 'No hay ninguna indicación anterior para repetir.';
      speak(text);
      showSystemBubble(`Repitiendo: ${text}`);
      break;
    }

    default:
      throw new Error(`Actuador no soportado: ${type || 'sin tipo'}`);
  }
}

// ─── Navegación por voz ─────────────────────────────────────

async function startVoiceNavigation(destination) {
  stopVoiceNavigation(false);

  try {
    const originInfo = await getCurrentOrigin();
    const origin = originInfo.origin;

    if (!origin) {
      const reason = originInfo.error ? ` Motivo: ${originInfo.error}` : '';
      showSystemBubble(`No tengo acceso a tu ubicación.${reason}`);
      speak('No tengo acceso fiable a tu ubicación. No puedo iniciar la navegación por voz.');
      return;
    }

    const geocode = await fetchJson(
      `/api/geocode?query=${encodeURIComponent(destination)}&near=${encodeURIComponent(origin)}`
    );
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
      ? `${distanceKm.toFixed(1)} kilómetros`
      : 'distancia no disponible';

    const firstInstruction = steps[firstStepIndex]?.instruction || 'Comienza la ruta.';
    const destinationName = simplifyDestinationName(voiceNavigationState.destination);

    showSystemBubble(`Ruta calculada hacia ${destinationName}. ${distanceText}.`);
    showNavigationBanner(firstInstruction);
    speak(`Ruta iniciada hacia ${destinationName}. Distancia aproximada ${distanceText}.`);
    speak(`Primera indicación: ${firstInstruction}`);

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
    showSystemBubble(`No pude iniciar navegación: ${details}`);
    speak('No pude iniciar la navegación por voz interna.');
  }
}

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

  hideNavigationBanner();

  if (announce && wasActive) {
    showSystemBubble('Navegación por voz detenida.');
    speak('Navegación por voz detenida.');
  }
}

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

  if (distanceToStep <= 120 && voiceNavigationState.announcedApproachIndex !== voiceNavigationState.nextStepIndex) {
    speak(`En aproximadamente ${Math.max(20, Math.round(distanceToStep))} metros, ${currentStep.instruction}`);
    updateNavigationInstruction(currentStep.instruction);
    voiceNavigationState.announcedApproachIndex = voiceNavigationState.nextStepIndex;
  }

  if (distanceToStep <= 25) {
    voiceNavigationState.nextStepIndex += 1;
    voiceNavigationState.announcedApproachIndex = -1;

    const nextStep = voiceNavigationState.steps[voiceNavigationState.nextStepIndex];

    if (!nextStep) {
      completeVoiceNavigation();
      return;
    }

    speak(`Ahora: ${nextStep.instruction}`);
    updateNavigationInstruction(nextStep.instruction);
  }
}

function handleNavigationWatchError() {
  showSystemBubble('Se perdió el seguimiento de ubicación durante la navegación.');
  speak('He perdido tu ubicación temporalmente.');
}

function completeVoiceNavigation() {
  const destination = simplifyDestinationName(voiceNavigationState.destination || 'el destino');
  stopVoiceNavigation(false);
  showSystemBubble(`Has llegado a ${destination}.`);
  showNavigationBanner(`🏁 Has llegado a ${destination}`);
  speak(`Has llegado a ${destination}.`);

  setTimeout(hideNavigationBanner, 8000);
}

// ─── Funciones auxiliares ───────────────────────────────────

async function fetchJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error || `Error HTTP ${response.status}`);
  }

  return data;
}

function getFirstNavigableStepIndex(steps) {
  const idx = steps.findIndex((step) => {
    const text = String(step?.instruction || '').toLowerCase();
    return text && !text.startsWith('empieza la ruta');
  });

  return idx >= 0 ? idx : 0;
}

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

function simplifyDestinationName(name) {
  const clean = String(name || '').replace(/\s+/g, ' ').trim();
  return clean.length > 80 ? `${clean.slice(0, 77)}...` : clean;
}

async function getCurrentOrigin() {
  if (!navigator.geolocation) {
    return { origin: null, error: 'Geolocalización no soportada por este navegador.' };
  }

  try {
    let position = await getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 3000
    });

    const { latitude, longitude } = position.coords;
    return { origin: `${latitude},${longitude}`, error: null };
  } catch (firstError) {
    try {
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

function formatGeolocationError(err) {
  const code = typeof err === 'object' && err !== null && 'code' in err ? Number(err.code) : NaN;

  if (code === 1) return 'Permiso de ubicación denegado en navegador o sistema operativo.';
  if (code === 2) return 'Ubicación no disponible (sin señal o servicio de localización).';
  if (code === 3) return 'Tiempo de espera agotado al obtener ubicación.';

  const message = typeof err === 'object' && err !== null && 'message' in err ? String(err.message) : '';
  return message || 'Error desconocido de geolocalización.';
}

function getCurrentPosition(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

function reportActuatorStatus(status, message) {
  socket.emit('actuator-status', { status, message });
}

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
 * Reproduce texto usando SpeechSynthesis cuando está disponible.
 * @param {string} text
 * @param {{ interrupt?: boolean }} options
 */
function speak(text, options = {}) {
  const synth = window.speechSynthesis;

  if (!synth) {
    console.warn('[TTS] SpeechSynthesis no está disponible.');
    return;
  }

  if (options.interrupt) {
    synth.cancel();
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'es-ES';
  synth.speak(utterance);
}
