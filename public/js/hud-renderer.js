/**
 * hud-renderer.js — Módulo de renderizado del HUD de MotoNav
 *
 * Gestiona la presentación visual de burbujas de conversación,
 * banner de navegación, zona de confirmación e indicadores de estado.
 * Separa la lógica de UI de la lógica de negocio (main.js).
 */

const MAX_BUBBLES = 4;
const BUBBLE_DISMISS_MS = 8000;

// --- Referencias DOM ---

const conversationZone = document.getElementById('conversation-zone');
const navigationBanner = document.getElementById('navigation-banner');
const navInstructionText = document.getElementById('nav-instruction-text');
const confirmationZone = document.getElementById('confirmation-zone');
const confirmationText = document.getElementById('confirmation-text');
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const micToggle = document.getElementById('mic-toggle');
const cameraToggle = document.getElementById('camera-toggle');
const connectionIndicator = document.getElementById('connection-indicator');
const connectionTextEl = document.getElementById('connection-text');
const voiceStatusOverlay = document.getElementById('voice-status-overlay');

// Timers activos para auto-dismiss
const activeBubbleTimers = [];

// --- Burbujas de conversación ---

/**
 * Muestra una burbuja del usuario (voz) en la zona de conversación.
 * @param {string} text — Texto reconocido del usuario
 */
export function showUserBubble(text) {
  _addBubble('user', '🎤', `"${text}"`);
}

/**
 * Muestra una burbuja del sistema (respuesta del agente) en la zona de conversación.
 * @param {string} text — Mensaje del sistema
 */
export function showSystemBubble(text) {
  _addBubble('system', '🤖', text);
}

/**
 * Crea y añade una burbuja al DOM.
 * @param {'user'|'system'} type
 * @param {string} iconEmoji
 * @param {string} text
 */
function _addBubble(type, iconEmoji, text) {
  const bubble = document.createElement('div');
  bubble.className = `bubble ${type}`;
  bubble.innerHTML = `
    <div class="bubble-icon">${iconEmoji}</div>
    <div class="bubble-content">${_escapeHtml(text)}</div>
  `;

  conversationZone.appendChild(bubble);

  // Limitar número de burbujas visibles
  while (conversationZone.children.length > MAX_BUBBLES) {
    const oldest = conversationZone.firstElementChild;
    if (oldest) oldest.remove();
  }

  // Auto-dismiss tras un tiempo
  const timer = setTimeout(() => {
    _dismissBubble(bubble);
  }, BUBBLE_DISMISS_MS);
  activeBubbleTimers.push(timer);
}

/**
 * Retira una burbuja con animación fade-out.
 * @param {HTMLElement} bubble
 */
function _dismissBubble(bubble) {
  if (!bubble || !bubble.parentNode) return;

  bubble.classList.add('dismissing');

  setTimeout(() => {
    if (bubble.parentNode) {
      bubble.remove();
    }
  }, 400);
}

// --- Banner de navegación ---

/**
 * Muestra el banner de navegación con una instrucción.
 * @param {string} instruction — Texto de la indicación de navegación
 */
export function showNavigationBanner(instruction) {
  navInstructionText.textContent = instruction;
  navigationBanner.classList.add('visible');
}

/**
 * Actualiza el texto del banner de navegación sin ocultar/mostrar.
 * @param {string} instruction
 */
export function updateNavigationInstruction(instruction) {
  navInstructionText.textContent = instruction;
}

/**
 * Oculta el banner de navegación.
 */
export function hideNavigationBanner() {
  navigationBanner.classList.remove('visible');
}

// --- Zona de confirmación ---

/**
 * Muestra la zona de confirmación con el texto de la acción pendiente.
 * @param {string} questionText — Texto de la pregunta (ej: "¿Quieres llamar a Mamá?")
 */
export function showConfirmationPrompt(questionText) {
  confirmationText.textContent = questionText;
  confirmationZone.classList.add('visible');
}

/**
 * Oculta la zona de confirmación.
 */
export function hideConfirmationPrompt() {
  confirmationZone.classList.remove('visible');
}

// --- Indicador de estado ---

const MODE_LABELS = {
  idle: 'En reposo',
  listening: 'Escuchando…',
  confirming: 'Esperando confirmación',
  navigating: 'Navegando'
};

/**
 * Actualiza el badge de estado del sistema.
 * @param {string} mode — Modo del sistema: idle, listening, confirming, navigating
 */
export function updateStatusBadge(mode) {
  statusBadge.setAttribute('data-mode', mode);
  statusText.textContent = MODE_LABELS[mode] || mode;

  // Mostrar/ocultar zona de confirmación según modo
  if (mode === 'confirming') {
    // La confirmación se muestra por separado con showConfirmationPrompt
  } else {
    hideConfirmationPrompt();
  }
}

// --- Controles de micrófono y cámara ---

/**
 * Actualiza el estado visual del botón de micrófono.
 * @param {boolean} active
 */
export function setMicrophoneActive(active) {
  if (active) {
    micToggle.classList.add('active', 'mic-listening');
    micToggle.setAttribute('aria-label', 'Desactivar micrófono');
    micToggle.title = 'Micrófono activo';
  } else {
    micToggle.classList.remove('active', 'mic-listening');
    micToggle.setAttribute('aria-label', 'Activar micrófono');
    micToggle.title = 'Micrófono';
  }
}

/**
 * Actualiza el estado visual del botón de cámara.
 * @param {boolean} active
 */
export function setCameraActive(active) {
  if (active) {
    cameraToggle.classList.add('active');
    cameraToggle.setAttribute('aria-label', 'Desactivar cámara de gestos');
    cameraToggle.title = 'Cámara activa';
  } else {
    cameraToggle.classList.remove('active');
    cameraToggle.setAttribute('aria-label', 'Activar cámara para gestos');
    cameraToggle.title = 'Cámara gestos';
  }
}

// --- Indicador de conexión ---

/**
 * Actualiza el indicador de conexión.
 * @param {boolean} connected
 */
export function setConnectionStatus(connected) {
  if (connected) {
    connectionIndicator.classList.add('connected');
    connectionTextEl.textContent = 'Conectado';
  } else {
    connectionIndicator.classList.remove('connected');
    connectionTextEl.textContent = 'Desconectado';
  }
}

// --- Estado de voz overlay ---

/**
 * Muestra un texto de estado de voz temporalmente.
 * @param {string} text
 */
export function showVoiceStatus(text) {
  voiceStatusOverlay.textContent = text;
  voiceStatusOverlay.classList.add('visible');
}

/**
 * Oculta el overlay de estado de voz.
 */
export function hideVoiceStatus() {
  voiceStatusOverlay.classList.remove('visible');
}

// --- Utilidades ---

/**
 * Escapa HTML para prevenir XSS en las burbujas.
 * @param {string} text
 * @returns {string}
 */
function _escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Limpia todas las burbujas y timers.
 */
export function clearAllBubbles() {
  conversationZone.innerHTML = '';
  for (const timer of activeBubbleTimers) {
    clearTimeout(timer);
  }
  activeBubbleTimers.length = 0;
}
