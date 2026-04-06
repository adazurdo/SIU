/**
 * gestures.js — Módulo de detección de gestos para MotoNav
 *
 * Utiliza MediaPipe Face Mesh para detectar gestos de cabeza del motorista:
 * - Asentir (nod) → confirmar acción
 * - Negar (shake) → cancelar acción
 *
 * Basado en el análisis de pitch (cabeceo) y yaw (giro lateral) calculados
 * a partir de landmarks faciales clave.
 */

export class GestureController {
  /**
   * @param {object} options
   * @param {function} options.onNod      — Callback al detectar asentimiento
   * @param {function} options.onShake    — Callback al detectar negación
   * @param {function} options.onStatusChange — Callback de estado: 'active', 'inactive', 'loading', 'error'
   */
  constructor(options = {}) {
    this.onNod = options.onNod || (() => {});
    this.onShake = options.onShake || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});

    this.isActive = false;
    this.faceMesh = null;
    this.camera = null;

    // --- Gesture detection state ---
    // Historial de ángulos recientes para detectar movimiento
    this.pitchHistory = [];   // Vertical (nod)
    this.yawHistory = [];     // Horizontal (shake)
    this.HISTORY_SIZE = 12;

    // Umbrales de detección
    this.NOD_THRESHOLD = 0.07;    // Variación mínima de pitch para nod
    this.SHAKE_THRESHOLD = 0.08;  // Variación mínima de yaw para shake

    // Cooldown entre gestos detectados (evita repeticiones)
    this.GESTURE_COOLDOWN_MS = 1800;
    this._lastGestureTime = 0;

    // Contadores para exigir consistencia del gesto
    this._nodConsecutive = 0;
    this._shakeConsecutive = 0;
    this.CONSECUTIVE_REQUIRED = 3;
  }

  /**
   * Inicia la detección de gestos.
   * @param {HTMLVideoElement} videoElement — Elemento <video> oculto para la cámara
   */
  async start(videoElement) {
    if (this.isActive) return;

    if (typeof FaceMesh === 'undefined' || typeof Camera === 'undefined') {
      console.error('[Gestos] MediaPipe no está cargado. Verifica los scripts CDN.');
      this.onStatusChange('error');
      return;
    }

    this.onStatusChange('loading');

    try {
      this.faceMesh = new FaceMesh({
        locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
        }
      });

      this.faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      this.faceMesh.onResults((results) => this._onResults(results));

      await this.faceMesh.initialize();

      this.camera = new Camera(videoElement, {
        onFrame: async () => {
          if (this.isActive && this.faceMesh) {
            await this.faceMesh.send({ image: videoElement });
          }
        },
        width: 320,
        height: 240
      });

      await this.camera.start();

      this.isActive = true;
      this.onStatusChange('active');
      console.log('[Gestos] Detección de gestos iniciada.');
    } catch (error) {
      console.error('[Gestos] Error al iniciar:', error);
      this.onStatusChange('error');
    }
  }

  /**
   * Detiene la detección de gestos.
   */
  stop() {
    if (this.camera) {
      this.camera.stop();
      this.camera = null;
    }

    this.isActive = false;
    this.pitchHistory = [];
    this.yawHistory = [];
    this._nodConsecutive = 0;
    this._shakeConsecutive = 0;
    this.onStatusChange('inactive');
    console.log('[Gestos] Detección de gestos detenida.');
  }

  /**
   * Procesa resultados de Face Mesh y detecta gestos.
   * @param {object} results — Resultados de MediaPipe Face Mesh
   */
  _onResults(results) {
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      return;
    }

    const landmarks = results.multiFaceLandmarks[0];
    const angles = this._estimateHeadAngles(landmarks);

    if (!angles) return;

    // Añadir al historial
    this.pitchHistory.push(angles.pitch);
    this.yawHistory.push(angles.yaw);

    if (this.pitchHistory.length > this.HISTORY_SIZE) {
      this.pitchHistory.shift();
    }
    if (this.yawHistory.length > this.HISTORY_SIZE) {
      this.yawHistory.shift();
    }

    // Solo detectar si ya tenemos suficiente historial
    if (this.pitchHistory.length < this.HISTORY_SIZE) return;

    this._detectGestures();
  }

  /**
   * Estima los ángulos de pitch y yaw de la cabeza basándose en landmarks clave.
   *
   * Landmarks usados:
   * - 10  = parte superior de la frente
   * - 152 = barbilla
   * - 234 = lateral izquierdo
   * - 454 = lateral derecho
   * - 1   = punta de la nariz
   *
   * @param {Array} landmarks
   * @returns {{ pitch: number, yaw: number } | null}
   */
  _estimateHeadAngles(landmarks) {
    if (!landmarks || landmarks.length < 468) return null;

    const nose = landmarks[1];
    const forehead = landmarks[10];
    const chin = landmarks[152];
    const leftCheek = landmarks[234];
    const rightCheek = landmarks[454];

    // Pitch: diferencia vertical nariz vs punto medio frente-barbilla
    const midY = (forehead.y + chin.y) / 2;
    const pitch = nose.y - midY;

    // Yaw: diferencia horizontal nariz vs punto medio izq-dch
    const midX = (leftCheek.x + rightCheek.x) / 2;
    const yaw = nose.x - midX;

    return { pitch, yaw };
  }

  /**
   * Analiza el historial de ángulos para detectar nods y shakes.
   */
  _detectGestures() {
    const now = Date.now();
    if (now - this._lastGestureTime < this.GESTURE_COOLDOWN_MS) {
      return;
    }

    const pitchVariation = this._getOscillation(this.pitchHistory);
    const yawVariation = this._getOscillation(this.yawHistory);

    // Detectar NOD (asentir): alta variación en pitch, baja en yaw
    if (pitchVariation > this.NOD_THRESHOLD && yawVariation < this.SHAKE_THRESHOLD) {
      this._nodConsecutive++;
      this._shakeConsecutive = 0;

      if (this._nodConsecutive >= this.CONSECUTIVE_REQUIRED) {
        this._lastGestureTime = now;
        this._nodConsecutive = 0;
        this.pitchHistory = [];
        this.yawHistory = [];
        console.log('[Gestos] ✅ Asentimiento detectado');
        this.onNod();
      }
    }
    // Detectar SHAKE (negar): alta variación en yaw, baja en pitch
    else if (yawVariation > this.SHAKE_THRESHOLD && pitchVariation < this.NOD_THRESHOLD) {
      this._shakeConsecutive++;
      this._nodConsecutive = 0;

      if (this._shakeConsecutive >= this.CONSECUTIVE_REQUIRED) {
        this._lastGestureTime = now;
        this._shakeConsecutive = 0;
        this.pitchHistory = [];
        this.yawHistory = [];
        console.log('[Gestos] ❌ Negación detectada');
        this.onShake();
      }
    } else {
      // Sin gesto claro, resetear contadores gradualmente
      this._nodConsecutive = Math.max(0, this._nodConsecutive - 1);
      this._shakeConsecutive = Math.max(0, this._shakeConsecutive - 1);
    }
  }

  /**
   * Calcula la "oscilación" (cambio de dirección) en un historial de valores.
   * Suma las diferencias absolutas entre frames consecutivos.
   *
   * @param {number[]} history
   * @returns {number}
   */
  _getOscillation(history) {
    if (history.length < 2) return 0;

    let totalChange = 0;
    let directionChanges = 0;
    let prevDelta = 0;

    for (let i = 1; i < history.length; i++) {
      const delta = history[i] - history[i - 1];
      totalChange += Math.abs(delta);

      // Contar cambios de dirección (oscilación)
      if (prevDelta !== 0 && Math.sign(delta) !== Math.sign(prevDelta)) {
        directionChanges++;
      }
      prevDelta = delta;
    }

    // Requiere al menos 2 cambios de dirección para considerar que es un gesto repetitivo
    if (directionChanges < 2) return 0;

    return totalChange;
  }
}
