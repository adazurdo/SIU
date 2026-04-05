import { fetchWithTimeout, isNetworkFetchError, isUpstreamTimeoutError } from './http-client.js';
import { normalizeForMatching } from '../utils/text.js';

/**
 * @param {string} query
 * @param {{ timeoutMs?: number }} options
 * @returns {Promise<{lat: number, lon: number, name: string}>}
 */
export async function geocodeDestination(query, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 8000);

  try {
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
