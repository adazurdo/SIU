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

    // Palabra de activacion del sistema
    this.WAKE_WORD = 'hey motonav';

    // Indica si el sistema esta esperando un comando tras la palabra de activacion
    this.isAwake = false;

    // Temporizador para volver a modo dormido si no se recibe comando
    this.awakeTimeout = null;
    this.AWAKE_DURATION = 5000; // 5 segundos para decir el comando

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
      console.error(`[Voz] Error: ${event.error}`);

      // Si el error es 'no-speech', simplemente reiniciar (es normal en uso continuo)
      if (event.error === 'no-speech') {
        return;
      }

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
    // Comprobar si contiene la palabra de activacion
    if (transcript.includes(this.WAKE_WORD)) {
      console.log('[Voz] Palabra de activacion detectada!');
      this._activate();

      // Si hay texto despues de la palabra de activacion, procesarlo como comando
      const commandAfterWake = transcript.split(this.WAKE_WORD).pop().trim();
      if (commandAfterWake.length > 0) {
        this._processCommand(commandAfterWake);
      }
      return;
    }

    // Si el sistema esta despierto, cualquier texto es un comando
    if (this.isAwake) {
      this._processCommand(transcript);
    }
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

    this.awakeTimeout = setTimeout(() => {
      this.isAwake = false;
      this.onStatusChange('sleeping');
      console.log('[Voz] Tiempo de espera agotado. Volviendo a modo dormido.');
    }, this.AWAKE_DURATION);
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
    this.recognition.stop();
    this.onStatusChange('stopped');
    console.log('[Voz] Reconocimiento de voz detenido.');
  }
}
