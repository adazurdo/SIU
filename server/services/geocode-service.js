import { fetchWithTimeout, isNetworkFetchError, isUpstreamTimeoutError } from './http-client.js';
import { normalizeForMatching } from '../utils/text.js';

/**
 * @param {string} query
 * @param {{ timeoutMs?: number, near?: { lat: number, lon: number } | null }} options
 * @returns {Promise<{lat: number, lon: number, name: string}>}
 */
export async function geocodeDestination(query, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 8000);
  const near = isValidLatLon(options.near) ? options.near : null;

  try {
    if (near && isNearbyFuelQuery(query)) {
      const nearbyFuel = await findNearbyFuelStation(near, timeoutMs);
      if (nearbyFuel) {
        return nearbyFuel;
      }
    }

    const geocodeQueries = buildGeocodeCandidates(query);
    let first = null;
    let hasSuccessfulResponse = false;

    for (const candidate of geocodeQueries) {
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('format', 'json');
      url.searchParams.set('limit', '5');
      url.searchParams.set('q', candidate);

      const response = await fetchWithTimeout(url, {
        headers: {
          'User-Agent': 'MotoNav-SIU/1.0 (educational project)'
        }
      }, timeoutMs);

      if (!response.ok) continue;
      hasSuccessfulResponse = true;

      const data = await response.json();
      const items = Array.isArray(data) ? data : [];
      if (items.length === 0) continue;

      first = selectBestGeocodeMatch(items, query);
      if (first) break;
    }

    if (!first) {
      const err = new Error(hasSuccessfulResponse
        ? 'No se encontro el destino solicitado'
        : 'No se pudo consultar el proveedor de geocodificacion');
      err.code = hasSuccessfulResponse ? 'GEOCODE_NOT_FOUND' : 'GEOCODE_UPSTREAM_UNAVAILABLE';
      throw err;
    }

    return {
      lat: Number(first.lat),
      lon: Number(first.lon),
      name: String(first.display_name || query)
    };
  } catch (error) {
    if (isUpstreamTimeoutError(error)) {
      const err = new Error('Tiempo de espera agotado geocodificando destino');
      err.code = 'GEOCODE_TIMEOUT';
      throw err;
    }

    if (isNetworkFetchError(error)) {
      const err = new Error('Fallo de red consultando geocodificacion');
      err.code = 'GEOCODE_UPSTREAM_ERROR';
      throw err;
    }

    if (error && typeof error === 'object' && 'code' in error) {
      throw error;
    }

    const err = new Error('Error interno geocodificando destino');
    err.code = 'GEOCODE_INTERNAL_ERROR';
    throw err;
  }
}

/**
 * @param {{ lat: number, lon: number }} near
 * @param {number} timeoutMs
 * @returns {Promise<{lat: number, lon: number, name: string} | null>}
 */
async function findNearbyFuelStation(near, timeoutMs) {
  const radiusKmCandidates = [2, 5, 12];
  const queryCandidates = ['[fuel]', 'gasolinera', 'estacion de servicio', 'gas station'];

  for (const radiusKm of radiusKmCandidates) {
    for (const query of queryCandidates) {
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('format', 'json');
      url.searchParams.set('limit', '10');
      url.searchParams.set('q', query);
      url.searchParams.set('viewbox', buildViewBox(near, radiusKm));
      url.searchParams.set('bounded', '1');

      const response = await fetchWithTimeout(url, {
        headers: {
          'User-Agent': 'MotoNav-SIU/1.0 (educational project)'
        }
      }, timeoutMs);

      if (!response.ok) continue;

      const data = await response.json();
      const items = Array.isArray(data) ? data : [];
      if (items.length === 0) continue;

      const closest = selectClosestResult(items, near);
      if (!closest) continue;

      return {
        lat: Number(closest.lat),
        lon: Number(closest.lon),
        name: String(closest.display_name || 'gasolinera cercana')
      };
    }
  }

  return null;
}

/**
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

  if (normalized.includes('universidad carlos tercero') || normalized.includes('carlos iii') || normalized.includes('uc3m')) {
    candidates.add('universidad carlos iii de madrid leganes');
    candidates.add('uc3m leganes');
    candidates.add('universidad carlos iii de madrid campus de leganes');
  }

  const dePunctuated = normalized.replace(/[,:;.!?]/g, ' ').replace(/\s+/g, ' ').trim();
  if (dePunctuated) {
    candidates.add(dePunctuated);
    candidates.add(`${dePunctuated}, madrid, espana`);
  }

  return Array.from(candidates);
}

/**
 * @param {string} query
 * @returns {boolean}
 */
function isNearbyFuelQuery(query) {
  const normalized = normalizeForMatching(query)
    .replace(/\s+/g, ' ')
    .trim();

  return (
    normalized === 'gasolinera' ||
    normalized === 'gasolineras' ||
    (normalized.includes('gasolin') && normalized.includes('cerca de mi')) ||
    normalized.includes('estacion de servicio cerca de mi')
  );
}

/**
 * @param {{ lat: number, lon: number }} near
 * @param {number} radiusKm
 * @returns {string}
 */
function buildViewBox(near, radiusKm) {
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.max(Math.cos((near.lat * Math.PI) / 180), 0.2));

  const minLon = near.lon - lonDelta;
  const maxLon = near.lon + lonDelta;
  const minLat = near.lat - latDelta;
  const maxLat = near.lat + latDelta;

  return `${minLon},${maxLat},${maxLon},${minLat}`;
}

/**
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

/**
 * @param {Array<any>} items
 * @param {{ lat: number, lon: number }} near
 * @returns {any | null}
 */
function selectClosestResult(items, near) {
  if (!Array.isArray(items) || items.length === 0) return null;

  const ranked = items
    .map((item) => {
      const lat = Number(item?.lat);
      const lon = Number(item?.lon);

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return null;
      }

      return {
        item,
        distance: distanceInKm(lat, lon, near.lat, near.lon)
      };
    })
    .filter(Boolean);

  ranked.sort((a, b) => a.distance - b.distance);
  return ranked[0]?.item || null;
}

/**
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number}
 */
function distanceInKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * @param {unknown} value
 * @returns {value is { lat: number, lon: number }}
 */
function isValidLatLon(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lon)
  );
}
