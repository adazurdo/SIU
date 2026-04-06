/**
 * voice.js - Modulo de reconocimiento de voz para MotoNav
 *
 * Utiliza la Web Speech API (SpeechRecognition) para capturar comandos de voz.
 * El reconocimiento se realiza en espanol y soporta comandos cortos como
 * "buscar gasolinera", "llamar a...", "cancelar", "confirmar", "repetir".
 *
 * Incluye una palabra de activacion ("hey motonav") para iniciar la escucha
 * de comandos, tal como se definio en la Idea A del proyecto.
 *
 * Basado en los conceptos de la Web Speech API vistos en clase (S5_L6).
 */

// --- Clase principal del modulo de voz ---

export class VoiceController {
  /**
   * @param {object} options - Opciones de configuracion
   * @param {function} options.onCommand - Callback cuando se detecta un comando
   * @param {function} options.onStatusChange - Callback cuando cambia el estado del reconocimiento
   */
  constructor(options = {}) {
    this.onCommand = options.onCommand || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});

    // Patrones de activacion tolerantes a variantes frecuentes de dictado
    this.WAKE_PATTERNS = [
      /\b(?:hey|ey|ei|oye)\s*moto\s*nav(?:e)?\b/i,
      /\bmoto\s*nav(?:e)?\b/i,
      /\bmotonav(?:e)?\b/i,
      /\bmotornav\b/i
    ];

    // Durante los primeros ms tras iniciar microfono, permitimos comandos directos.
    this.STARTUP_AUTO_WAKE_MS = 2500;
    this.startedListeningAt = 0;

    // Indica si el sistema esta esperando un comando tras la palabra de activacion
    this.isAwake = false;

    // Temporizador opcional para volver a modo dormido
    this.awakeTimeout = null;
    this.AWAKE_DURATION = null; // null -> esperar comando sin expirar por tiempo

    // Instancia del reconocedor de voz
    this.recognition = null;

    // Estado actual del modulo
    this.isActive = false;

    this._initRecognition();
  }

  /**
   * Inicializa el objeto SpeechRecognition con la configuracion adecuada.
   * Se usa webkitSpeechRecognition como fallback para navegadores basados en Chromium.
   */
  _initRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.error('[Voz] La Web Speech API no esta soportada en este navegador.');
      this.onStatusChange('no-support');
      return;
    }

    this.recognition = new SpeechRecognition();

    // Configuracion del reconocimiento

    // Idioma: español
    this.recognition.lang = 'es-ES';          
    // Reconocimiento continuo (no se para tras una frase)
    this.recognition.continuous = true;         
    // Solo resultados finales (no parciales)
    this.recognition.interimResults = false;    

    // Evento: resultado de reconocimiento 
    this.recognition.onresult = (event) => {
      // Obtener el ultimo resultado reconocido
      const lastResultIndex = event.results.length - 1;
      const transcript = event.results[lastResultIndex][0].transcript.toLowerCase().trim();
      const confidence = event.results[lastResultIndex][0].confidence;

      console.log(`[Voz] Reconocido: "${transcript}" (confianza: ${(confidence * 100).toFixed(1)}%)`);

      this._handleTranscript(transcript);
    };

    // Evento: error en el reconocimiento
    this.recognition.onerror = (event) => {
      // Si el error es 'no-speech', simplemente reiniciar (es normal en uso continuo)
      if (event.error === 'no-speech') {
        console.debug('[Voz] Sin voz detectada en este ciclo; reintentando.');
        return;
      }

      console.error(`[Voz] Error: ${event.error}`);
      this.onStatusChange('error');
    };

    // Evento: el reconocimiento se ha detenido 
    // En modo continuo, lo reiniciamos automaticamente si el modulo sigue activo
    this.recognition.onend = () => {
      if (this.isActive) {
        console.log('[Voz] Reconocimiento reiniciado automaticamente.');
        this.recognition.start();
      }
    };
  }

  /**
   * Procesa el texto reconocido. Primero comprueba si contiene la palabra
   * de activacion; si el sistema ya esta "despierto", trata el texto como un comando.
   * @param {string} transcript - Texto reconocido por la Web Speech API
   */
  _handleTranscript(transcript) {
    const normalizedTranscript = normalizeForMatching(transcript);

    // Permitir comandos de control sin wake word para mejorar el flujo de confirmacion.
    // Esto evita tener que repetir "hey motonav" justo antes de "confirmar".
    const controlCommands = ['confirmar', 'cancelar', 'repetir'];
    const isControlCommand = hasAnyWord(normalizedTranscript, controlCommands);

    if (isControlCommand) {
      this._processCommand(normalizedTranscript);
      return;
    }

    // Comprobar si contiene alguna palabra de activacion
    const wakeExtraction = extractWakeCommand(normalizedTranscript, this.WAKE_PATTERNS);
    if (wakeExtraction.detected) {
      console.log('[Voz] Palabra de activacion detectada!');
      this._activate();

      // Si hay texto despues de la palabra de activacion, procesarlo como comando
      const commandAfterWake = wakeExtraction.commandAfterWake;
      if (commandAfterWake.length > 0) {
        this._processCommand(commandAfterWake);
      }
      return;
    }

    // Ventana corta tras iniciar microfono para no perder el primer comando.
    if (!this.isAwake && this._isWithinStartupWindow() && looksLikeDirectCommand(normalizedTranscript)) {
      console.log('[Voz] Comando directo detectado en ventana de arranque.');
      this._processCommand(normalizedTranscript);
      return;
    }

    // Si el sistema esta despierto, cualquier texto es un comando
    if (this.isAwake) {
      this._processCommand(normalizedTranscript);
    }
  }

  _isWithinStartupWindow() {
    if (!this.startedListeningAt) return false;

    const elapsed = Date.now() - this.startedListeningAt;
    return elapsed >= 0 && elapsed <= this.STARTUP_AUTO_WAKE_MS;
  }

  /**
   * Activa el modo "despierto" del sistema tras detectar la palabra de activacion.
   * El sistema permanece despierto durante AWAKE_DURATION milisegundos.
   */
  _activate() {
    this.isAwake = true;
    this.onStatusChange('awake');

    // Reiniciar el temporizador de tiempo de espera
    if (this.awakeTimeout) {
      clearTimeout(this.awakeTimeout);
    }

    if (typeof this.AWAKE_DURATION === 'number' && this.AWAKE_DURATION > 0) {
      this.awakeTimeout = setTimeout(() => {
        this.isAwake = false;
        this.onStatusChange('sleeping');
        console.log('[Voz] Tiempo de espera agotado. Volviendo a modo dormido.');
      }, this.AWAKE_DURATION);
    }
  }

  /**
   * Envia el comando reconocido al callback configurado.
   * @param {string} command - Texto del comando a procesar
   */
  _processCommand(command) {
    console.log(`[Voz] Comando procesado: "${command}"`);
    this.isAwake = false;

    if (this.awakeTimeout) {
      clearTimeout(this.awakeTimeout);
    }

    this.onStatusChange('command-received');
    this.onCommand(command);
  }

  /**
   * Inicia el reconocimiento de voz. Requiere permiso de microfono.
   */
  start() {
    if (!this.recognition) {
      console.error('[Voz] No se puede iniciar: Web Speech API no disponible.');
      return;
    }

    this.isActive = true;
    this.startedListeningAt = Date.now();
    this.recognition.start();
    this.onStatusChange('listening');
    console.log('[Voz] Reconocimiento de voz iniciado. Di "Hey MotoNav" para activar.');
  }

  /**
   * Detiene el reconocimiento de voz.
   */
  stop() {
    if (!this.recognition) return;

    this.isActive = false;
    this.isAwake = false;
    this.startedListeningAt = 0;
    this.recognition.stop();
    this.onStatusChange('stopped');
    console.log('[Voz] Reconocimiento de voz detenido.');
  }
}

/**
 * Extrae el comando tras la wake word si existe.
 *
 * @param {string} transcript
 * @param {RegExp[]} wakePatterns
 * @returns {{ detected: boolean, commandAfterWake: string }}
 */
function extractWakeCommand(normalizedTranscript, wakePatterns) {
  const strictWake = extractCommandAfterWakeWord(normalizedTranscript, wakePatterns);
  if (strictWake.detected) {
    return strictWake;
  }

  return extractCommandAfterLooseMotoWake(normalizedTranscript);
}

/**
 * Extrae el comando tras una wake word reconocida de forma estricta.
 *
 * @param {string} normalizedTranscript
 * @param {RegExp[]} wakePatterns
 * @returns {{ detected: boolean, commandAfterWake: string }}
 */
function extractCommandAfterWakeWord(normalizedTranscript, wakePatterns) {
  for (const pattern of wakePatterns) {
    const match = normalizedTranscript.match(pattern);
    if (!match || typeof match.index !== 'number') continue;

    const after = normalizedTranscript
      .slice(match.index + match[0].length)
      .replace(/^[\s,;:.!?-]+/, '')
      .trim();

    return {
      detected: true,
      commandAfterWake: after
    };
  }

  return {
    detected: false,
    commandAfterWake: ''
  };
}

/**
 * Fallback tolerante a errores frecuentes de dictado tras "hey moto...".
 * Solo activa si lo que sigue parece un comando valido del sistema.
 *
 * @param {string} normalizedTranscript
 * @returns {{ detected: boolean, commandAfterWake: string }}
 */
function extractCommandAfterLooseMotoWake(normalizedTranscript) {
  const match = normalizedTranscript.match(/\b(?:hey|ey|ei|oye)\s+moto[a-z]*\b[\s,;:.!?-]*(.+)$/i);
  if (!match || !match[1]) {
    return {
      detected: false,
      commandAfterWake: ''
    };
  }

  const commandAfterWake = match[1].trim();
  const controlCommands = ['confirmar', 'cancelar', 'repetir'];

  if (commandAfterWake.length === 0) {
    return {
      detected: true,
      commandAfterWake: ''
    };
  }

  if (looksLikeDirectCommand(commandAfterWake) || hasAnyWord(commandAfterWake, controlCommands)) {
    return {
      detected: true,
      commandAfterWake
    };
  }

  return {
    detected: false,
    commandAfterWake: ''
  };
}

/**
 * Heuristica minima para aceptar comandos directos al arrancar microfono.
 *
 * @param {string} transcript
 * @returns {boolean}
 */
function looksLikeDirectCommand(transcript) {
  const directCommandHints = [
    'buscar gasolinera',
    'gasolinera',
    'llamar a',
    'llama a',
    'como llegar a',
    'ir a',
    'llevame a',
    'navega a',
    'ruta a'
  ];

  return directCommandHints.some((hint) => transcript.includes(hint));
}

/**
 * Normaliza texto para comparaciones robustas.
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeForMatching(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detecta si existe una palabra completa del listado en el texto.
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
