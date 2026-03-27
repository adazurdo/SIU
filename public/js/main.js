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
      'awake': 'Activo! Di tu comando...',
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
