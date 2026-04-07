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

const socket = io();

const VALID_ROLES = new Set(['pilot', 'companion']);
const ROLE_METADATA = Object.freeze({
  pilot: {
    label: 'Pilot HUD',
    displayName: 'HUD principal',
    capabilities: {
      navigation: true,
      telephony: false,
      remoteControl: false,
      voiceInput: true,
      gestures: true
    }
  },
  companion: {
    label: 'Companion',
    displayName: 'Panel remoto',
    capabilities: {
      navigation: false,
      telephony: true,
      remoteControl: true,
      voiceInput: false,
      gestures: false
    }
  }
});

const roleSelector = document.getElementById('role-selector');
const roleCards = Array.from(document.querySelectorAll('[data-role-option]'));
const companionRoleChip = document.getElementById('companion-role-chip');
const companionMode = document.getElementById('companion-mode');
const companionLastCommand = document.getElementById('companion-last-command');
const companionLastResult = document.getElementById('companion-last-result');
const companionPendingAction = document.getElementById('companion-pending-action');
const companionConnectedCount = document.getElementById('companion-connected-count');
const companionDevicesList = document.getElementById('companion-devices-list');
const companionActivityList = document.getElementById('companion-activity-list');
const quickActionButtons = Array.from(document.querySelectorAll('[data-command]'));
const manualCommandForm = document.getElementById('manual-command-form');
const manualCommandInput = document.getElementById('manual-command-input');
const micToggle = document.getElementById('mic-toggle');
const cameraToggle = document.getElementById('camera-toggle');
const gestureVideo = document.getElementById('gesture-video');

let deviceRole = readRoleFromUrl();
let currentMode = 'idle';
let lastSystemMessage = '';
let voiceController = null;
let gestureController = null;

const activityEntries = [];
const systemSnapshot = {
  mode: 'idle',
  lastCommand: null,
  connectedClients: 0,
  pendingAction: null,
  lastResult: null,
  devices: []
};

const voiceNavigationState = {
  active: false,
  watchId: null,
  destination: '',
  steps: [],
  nextStepIndex: 0,
  announcedApproachIndex: -1
};

bindStaticEvents();
applyRole(deviceRole, { updateUrl: false });
renderCompanionState();

socket.on('connect', () => {
  setConnectionStatus(true);
  addActivity('Conexion con servidor establecida.', 'success');
  registerCurrentDevice();
});

socket.on('disconnect', () => {
  setConnectionStatus(false);
  addActivity('Conexion con servidor perdida.', 'warn');
});

socket.on('system-state', (payload) => {
  const state = unwrapEventData(payload);

  currentMode = typeof state.mode === 'string' ? state.mode : currentMode;
  systemSnapshot.mode = currentMode;
  systemSnapshot.lastCommand = typeof state.lastCommand === 'string' ? state.lastCommand : null;
  systemSnapshot.connectedClients = Number.isFinite(Number(state.connectedClients))
    ? Number(state.connectedClients)
    : 0;
  systemSnapshot.pendingAction = state.pendingAction || null;
  systemSnapshot.lastResult = state.lastResult || null;
  systemSnapshot.devices = Array.isArray(state.devices) ? state.devices : [];

  updateStatusBadge(systemSnapshot.mode);
  updatePilotConfirmation(systemSnapshot);
  renderCompanionState();
});

socket.on('action-result', (payload) => {
  const result = unwrapEventData(payload);
  const message = typeof result.message === 'string' ? result.message : '';

  if (message) {
    lastSystemMessage = message;

    if (deviceRole === 'pilot') {
      showSystemBubble(message);
    }

    addActivity(message, payload?.ok === false ? 'warn' : 'success');
  }

  systemSnapshot.lastResult = {
    action: result.action || null,
    code: payload?.code || result.code || null,
    message,
    mode: result.newMode || currentMode,
    at: new Date().toISOString()
  };

  renderCompanionState();
});

socket.on('actuator-exec', async (payload) => {
  const instruction = unwrapEventData(payload);
  const actuatorType = String(instruction?.type || 'desconocido');

  addActivity(`Actuador recibido: ${actuatorType}.`, 'info');

  try {
    await runActuator(instruction);
    reportActuatorStatus('ok', `Actuador ejecutado: ${actuatorType}`);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);

    if (deviceRole === 'pilot') {
      showSystemBubble(`Error: ${details}`);
    }

    addActivity(`Fallo en ${actuatorType}: ${details}`, 'warn');
    reportActuatorStatus('error', `Fallo en ${actuatorType}: ${details}`);
  }
});

socket.on('actuator-status-ack', (payload) => {
  const ack = unwrapEventData(payload);
  const status = ack.status === 'ok' ? 'success' : 'warn';
  const message = typeof ack.message === 'string' ? ack.message : 'Estado de actuador actualizado.';
  addActivity(message, status);
});

function bindStaticEvents() {
  roleCards.forEach((card) => {
    card.addEventListener('click', () => {
      applyRole(card.dataset.roleOption || '');
    });
  });

  quickActionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (deviceRole !== 'companion') return;
      sendCommand(button.dataset.command || '');
    });
  });

  manualCommandForm?.addEventListener('submit', (event) => {
    event.preventDefault();

    if (deviceRole !== 'companion') return;

    const command = String(manualCommandInput?.value || '').trim();
    if (!command) return;

    sendCommand(command);
    manualCommandInput.value = '';
  });

  micToggle?.addEventListener('click', () => {
    if (deviceRole !== 'pilot') return;

    const controller = ensureVoiceController();

    if (controller.isActive) {
      controller.stop();
      setMicrophoneActive(false);
      addActivity('Microfono del pilot desactivado.', 'info');
      return;
    }

    controller.start();
    setMicrophoneActive(true);
    addActivity('Microfono del pilot activado.', 'info');
  });

  cameraToggle?.addEventListener('click', () => {
    if (deviceRole !== 'pilot') return;

    const controller = ensureGestureController();

    if (controller.isActive) {
      controller.stop();
      addActivity('Camara de gestos detenida.', 'info');
      return;
    }

    controller.start(gestureVideo);
    addActivity('Camara de gestos activada.', 'info');
  });
}

function readRoleFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const role = String(params.get('role') || '').trim();
  return VALID_ROLES.has(role) ? role : 'unassigned';
}

function applyRole(role, options = {}) {
  const normalizedRole = VALID_ROLES.has(role) ? role : 'unassigned';
  const shouldUpdateUrl = options.updateUrl !== false;

  deviceRole = normalizedRole;
  document.body.dataset.role = normalizedRole;

  if (roleSelector) {
    roleSelector.hidden = normalizedRole !== 'unassigned';
  }

  if (shouldUpdateUrl) {
    const nextUrl = new URL(window.location.href);

    if (VALID_ROLES.has(normalizedRole)) {
      nextUrl.searchParams.set('role', normalizedRole);
    } else {
      nextUrl.searchParams.delete('role');
    }

    window.history.replaceState({}, '', nextUrl);
  }

  if (normalizedRole !== 'pilot') {
    stopPilotSensors();
    hideConfirmationPrompt();
  }

  updateDocumentTitle();
  renderCompanionState();
  registerCurrentDevice();
}

function updateDocumentTitle() {
  const prefix = VALID_ROLES.has(deviceRole)
    ? ROLE_METADATA[deviceRole].label
    : 'Seleccion de pantalla';

  document.title = `MotoNav | ${prefix}`;
}

function registerCurrentDevice() {
  if (!socket.connected || !VALID_ROLES.has(deviceRole)) return;

  const roleMeta = ROLE_METADATA[deviceRole];

  socket.emit('device-register', {
    role: deviceRole,
    name: roleMeta.label,
    capabilities: roleMeta.capabilities
  });
}

function ensureVoiceController() {
  if (voiceController) return voiceController;

  voiceController = new VoiceController({
    onCommand: (command) => {
      sendCommand(command, { localBubble: true });
    },
    onStatusChange: (status) => {
      const statusMessages = {
        listening: 'Escuchando... (di "Hey MotoNav")',
        awake: 'Escuchando. Di tu comando.',
        sleeping: 'Escuchando... (di "Hey MotoNav")',
        'command-received': 'Comando recibido',
        stopped: 'Inactivo',
        error: 'Error en el reconocimiento',
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

  return voiceController;
}

function ensureGestureController() {
  if (gestureController) return gestureController;

  gestureController = new GestureController({
    onNod: () => {
      sendCommand('confirmar', {
        localBubble: true,
        activityMessage: 'Asentimiento detectado. Se envia confirmar.'
      });
    },
    onShake: () => {
      sendCommand('cancelar', {
        localBubble: true,
        activityMessage: 'Negacion detectada. Se envia cancelar.'
      });
    },
    onStatusChange: (status) => {
      if (status === 'active') {
        setCameraActive(true);
        showSystemBubble('Camara de gestos activada. Asiente o niega con la cabeza.');
      } else if (status === 'inactive') {
        setCameraActive(false);
      } else if (status === 'loading') {
        showSystemBubble('Inicializando deteccion de gestos...');
      } else if (status === 'error') {
        setCameraActive(false);
        showSystemBubble('Error al iniciar la camara de gestos.');
      }
    }
  });

  return gestureController;
}

function stopPilotSensors() {
  if (voiceController?.isActive) {
    voiceController.stop();
  }

  if (gestureController?.isActive) {
    gestureController.stop();
  }

  setMicrophoneActive(false);
  setCameraActive(false);
  hideVoiceStatus();
}

function sendCommand(command, options = {}) {
  const normalized = String(command || '').trim();
  if (!normalized) return;

  if (options.localBubble && deviceRole === 'pilot') {
    showUserBubble(normalized);
  }

  socket.emit('voice-command', { command: normalized });
  addActivity(options.activityMessage || `Comando enviado: ${normalized}`, 'info');
}

function updatePilotConfirmation(state) {
  if (deviceRole !== 'pilot') {
    hideConfirmationPrompt();
    return;
  }

  if (state.mode === 'confirming' && state.pendingAction) {
    showConfirmationPrompt(buildPendingQuestion(state.pendingAction));
    return;
  }

  hideConfirmationPrompt();
}

function renderCompanionState() {
  if (companionRoleChip) {
    companionRoleChip.textContent = VALID_ROLES.has(deviceRole)
      ? ROLE_METADATA[deviceRole].displayName
      : 'Seleccion pendiente';
  }

  if (companionMode) {
    companionMode.textContent = formatMode(systemSnapshot.mode);
  }

  if (companionLastCommand) {
    companionLastCommand.textContent = systemSnapshot.lastCommand || 'Sin comandos todavia';
  }

  if (companionLastResult) {
    companionLastResult.textContent = systemSnapshot.lastResult?.message || 'Sin respuesta todavia';
  }

  if (companionPendingAction) {
    companionPendingAction.textContent = describePendingAction(systemSnapshot.pendingAction);
  }

  if (companionConnectedCount) {
    companionConnectedCount.textContent = String(
      systemSnapshot.connectedClients || systemSnapshot.devices.length || 0
    );
  }

  renderDeviceList(systemSnapshot.devices);
  renderActivityList();
}

function renderDeviceList(devices) {
  if (!companionDevicesList) return;

  companionDevicesList.innerHTML = '';

  if (!Array.isArray(devices) || devices.length === 0) {
    companionDevicesList.appendChild(buildEmptyListItem('No hay otras pantallas registradas.'));
    return;
  }

  devices.forEach((device) => {
    const item = document.createElement('li');
    item.className = 'device-item';

    const meta = document.createElement('div');
    meta.className = 'device-meta';

    const title = document.createElement('strong');
    title.textContent = device.name || device.label || device.role || 'Pantalla';

    const subtitle = document.createElement('span');
    subtitle.textContent = buildDeviceSubtitle(device);

    meta.appendChild(title);
    meta.appendChild(subtitle);

    const badge = document.createElement('span');
    badge.className = 'device-role-badge';
    badge.textContent = device.role || 'sin rol';

    item.appendChild(meta);
    item.appendChild(badge);
    companionDevicesList.appendChild(item);
  });
}

function renderActivityList() {
  if (!companionActivityList) return;

  companionActivityList.innerHTML = '';

  if (activityEntries.length === 0) {
    companionActivityList.appendChild(buildEmptyListItem('Sin actividad reciente.'));
    return;
  }

  activityEntries.forEach((entry) => {
    const item = document.createElement('li');
    item.className = 'activity-item';
    item.dataset.tone = entry.tone;

    const time = document.createElement('span');
    time.className = 'activity-time';
    time.textContent = entry.time;

    const text = document.createElement('span');
    text.className = 'activity-text';
    text.textContent = entry.message;

    item.appendChild(time);
    item.appendChild(text);
    companionActivityList.appendChild(item);
  });
}

function addActivity(message, tone = 'info') {
  const normalizedMessage = String(message || '').trim();
  if (!normalizedMessage) return;

  activityEntries.unshift({
    message: normalizedMessage,
    tone,
    time: new Date().toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  });

  if (activityEntries.length > 10) {
    activityEntries.length = 10;
  }

  renderActivityList();
}

function buildEmptyListItem(message) {
  const item = document.createElement('li');
  item.className = 'empty-list-item';
  item.textContent = message;
  return item;
}

function buildDeviceSubtitle(device) {
  const labels = [];

  if (device?.capabilities?.navigation) labels.push('navegacion');
  if (device?.capabilities?.voiceInput) labels.push('voz');
  if (device?.capabilities?.gestures) labels.push('gestos');
  if (device?.capabilities?.remoteControl) labels.push('control remoto');
  if (device?.capabilities?.telephony) labels.push('telefonia');

  return labels.length > 0 ? labels.join(' · ') : 'sin capacidades declaradas';
}

function buildPendingQuestion(action) {
  const type = String(action?.type || '');

  if (type === 'call_contact') {
    return `Quieres llamar a ${action?.payload?.contactName || 'contacto'}?`;
  }

  if (type === 'start_voice_navigation') {
    return `Quieres navegar hacia ${action?.payload?.destination || 'destino'}?`;
  }

  if (type === 'navigate_google_maps_directions') {
    return `Quieres abrir la ruta hacia ${action?.payload?.destination || 'destino'}?`;
  }

  if (type === 'navigate_google_maps') {
    return `Quieres buscar ${action?.payload?.query || 'esa ubicacion'}?`;
  }

  return `Quieres ejecutar ${type || 'la accion pendiente'}?`;
}

function describePendingAction(action) {
  if (!action || !action.type) return 'No hay acciones pendientes';

  if (action.type === 'call_contact') {
    return `Llamada pendiente a ${action?.payload?.contactName || 'contacto'}`;
  }

  if (action.type === 'start_voice_navigation') {
    return `Navegacion pendiente hacia ${action?.payload?.destination || 'destino'}`;
  }

  return `Pendiente: ${action.type}`;
}

function formatMode(mode) {
  const labels = {
    idle: 'En reposo',
    listening: 'Escuchando',
    confirming: 'Esperando confirmacion',
    navigating: 'Navegando'
  };

  return labels[mode] || mode || 'Sin estado';
}

function unwrapEventData(payload) {
  if (payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object') {
    return payload.data;
  }

  return payload || {};
}

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

      window.location.href = `tel:${digits}`;

      if (deviceRole === 'pilot') {
        showSystemBubble(`Llamando al numero ${digits}...`);
      }

      break;
    }

    case 'repeat_last_message': {
      const text = lastSystemMessage || 'No hay ninguna indicacion anterior para repetir.';
      speak(text);

      if (deviceRole === 'pilot') {
        showSystemBubble(`Repitiendo: ${text}`);
      }

      break;
    }

    default:
      throw new Error(`Actuador no soportado: ${type || 'sin tipo'}`);
  }
}

async function startVoiceNavigation(destination) {
  stopVoiceNavigation(false);

  try {
    const originInfo = await getCurrentOrigin();
    const origin = originInfo.origin;

    if (!origin) {
      const reason = originInfo.error ? ` Motivo: ${originInfo.error}` : '';

      if (deviceRole === 'pilot') {
        showSystemBubble(`No tengo acceso a tu ubicacion.${reason}`);
      }

      speak('No tengo acceso fiable a tu ubicacion. No puedo iniciar la navegacion por voz.');
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
      ? `${distanceKm.toFixed(1)} kilometros`
      : 'distancia no disponible';

    const firstInstruction = steps[firstStepIndex]?.instruction || 'Comienza la ruta.';
    const destinationName = simplifyDestinationName(voiceNavigationState.destination);

    if (deviceRole === 'pilot') {
      showSystemBubble(`Ruta calculada hacia ${destinationName}. ${distanceText}.`);
      showNavigationBanner(firstInstruction);
    }

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

    if (deviceRole === 'pilot') {
      showSystemBubble(`No pude iniciar navegacion: ${details}`);
    }

    speak('No pude iniciar la navegacion por voz interna.');
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
    if (deviceRole === 'pilot') {
      showSystemBubble('Navegacion por voz detenida.');
    }

    speak('Navegacion por voz detenida.');
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

    if (deviceRole === 'pilot') {
      updateNavigationInstruction(currentStep.instruction);
    }

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

    if (deviceRole === 'pilot') {
      updateNavigationInstruction(nextStep.instruction);
    }
  }
}

function handleNavigationWatchError() {
  if (deviceRole === 'pilot') {
    showSystemBubble('Se perdio el seguimiento de ubicacion durante la navegacion.');
  }

  speak('He perdido tu ubicacion temporalmente.');
}

function completeVoiceNavigation() {
  const destination = simplifyDestinationName(voiceNavigationState.destination || 'el destino');
  stopVoiceNavigation(false);

  if (deviceRole === 'pilot') {
    showSystemBubble(`Has llegado a ${destination}.`);
    showNavigationBanner(`Has llegado a ${destination}`);
    setTimeout(hideNavigationBanner, 8000);
  }

  speak(`Has llegado a ${destination}.`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error || `Error HTTP ${response.status}`);
  }

  return data;
}

function getFirstNavigableStepIndex(steps) {
  const index = steps.findIndex((step) => {
    const text = String(step?.instruction || '').toLowerCase();
    return text && !text.startsWith('empieza la ruta');
  });

  return index >= 0 ? index : 0;
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
    return { origin: null, error: 'Geolocalizacion no soportada por este navegador.' };
  }

  try {
    const precisePosition = await getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 3000
    });

    return {
      origin: `${precisePosition.coords.latitude},${precisePosition.coords.longitude}`,
      error: null
    };
  } catch (firstError) {
    try {
      const fallbackPosition = await getCurrentPosition({
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 30000
      });

      return {
        origin: `${fallbackPosition.coords.latitude},${fallbackPosition.coords.longitude}`,
        error: null
      };
    } catch (secondError) {
      return {
        origin: null,
        error: formatGeolocationError(secondError || firstError)
      };
    }
  }
}

function formatGeolocationError(error) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? Number(error.code) : NaN;

  if (code === 1) return 'Permiso de ubicacion denegado en navegador o sistema operativo.';
  if (code === 2) return 'Ubicacion no disponible.';
  if (code === 3) return 'Tiempo de espera agotado al obtener ubicacion.';

  const message = typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : '';

  return message || 'Error desconocido de geolocalizacion.';
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

function speak(text, options = {}) {
  const synth = window.speechSynthesis;

  if (!synth) {
    console.warn('[TTS] SpeechSynthesis no esta disponible.');
    return;
  }

  if (options.interrupt) {
    synth.cancel();
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'es-ES';
  synth.speak(utterance);
}
