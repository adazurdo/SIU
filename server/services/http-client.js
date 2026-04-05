/**
 * Ejecuta fetch con timeout para dependencias externas.
 *
 * @param {URL | string} url
 * @param {RequestInit} options
 * @param {number} timeoutMs
 * @returns {Promise<Response>}
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (isAbortError(error)) {
      const timeoutError = new Error('External request timeout');
      timeoutError.code = 'UPSTREAM_TIMEOUT';
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isUpstreamTimeoutError(error) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'UPSTREAM_TIMEOUT');
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isNetworkFetchError(error) {
  return error instanceof TypeError;
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isAbortError(error) {
  return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError');
}
