import { fetchWithTimeout, isNetworkFetchError, isUpstreamTimeoutError } from './http-client.js';

/**
 * @param {string} raw
 * @returns {{lat: number, lon: number} | null}
 */
export function parseLatLonParam(raw) {
  const [latRaw, lonRaw] = String(raw).split(',');
  const lat = Number(latRaw);
  const lon = Number(lonRaw);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  return { lat, lon };
}

/**
 * @param {{lat: number, lon: number}} origin
 * @param {{lat: number, lon: number}} destination
 * @param {{ timeoutMs?: number }} options
 * @returns {Promise<{distance: number, duration: number, steps: Array<any>}>
 */
export async function calculateRoute(origin, destination, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 8000);

  try {
    const routeUrl = new URL(
      `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}`
    );

    routeUrl.searchParams.set('overview', 'false');
    routeUrl.searchParams.set('alternatives', 'false');
    routeUrl.searchParams.set('steps', 'true');

    const response = await fetchWithTimeout(routeUrl, {}, timeoutMs);

    if (!response.ok) {
      const err = new Error('No se pudo obtener la ruta');
      err.code = 'ROUTE_UPSTREAM_BAD_STATUS';
      err.details = `HTTP ${response.status}`;
      throw err;
    }

    const data = await response.json();
    const route = data?.routes?.[0];
    const rawSteps = route?.legs?.[0]?.steps || [];

    if (!route || rawSteps.length === 0) {
      const err = new Error('No hay pasos de ruta disponibles para ese destino');
      err.code = 'ROUTE_NOT_FOUND';
      throw err;
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

    return {
      distance: Number(route.distance || 0),
      duration: Number(route.duration || 0),
      steps
    };
  } catch (error) {
    if (isUpstreamTimeoutError(error)) {
      const err = new Error('Tiempo de espera agotado calculando ruta');
      err.code = 'ROUTE_TIMEOUT';
      throw err;
    }

    if (isNetworkFetchError(error)) {
      const err = new Error('Fallo de red consultando el servicio de rutas');
      err.code = 'ROUTE_UPSTREAM_ERROR';
      throw err;
    }

    if (error && typeof error === 'object' && 'code' in error) {
      throw error;
    }

    const err = new Error('Error interno calculando ruta');
    err.code = 'ROUTE_INTERNAL_ERROR';
    throw err;
  }
}

/**
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
