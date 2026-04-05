/**
 * @param {string | undefined} raw
 * @returns {Set<string>}
 */
export function parseAllowedOrigins(raw) {
  const fallback = ['http://localhost:3000', 'http://127.0.0.1:3000'];
  const source = (raw || fallback.join(',')).split(',');
  return new Set(source.map((origin) => origin.trim()).filter(Boolean));
}

/**
 * @param {Set<string>} allowedOrigins
 * @returns {(origin: string | undefined) => boolean}
 */
export function createOriginMatcher(allowedOrigins) {
  return function isOriginAllowed(origin) {
    // Permite clientes sin Origin (curl, herramientas locales)
    if (!origin) return true;
    return allowedOrigins.has(origin);
  };
}

/**
 * @param {{ allowedOrigins: Set<string> }} options
 */
export function createCorsMiddleware(options) {
  const isOriginAllowed = createOriginMatcher(options.allowedOrigins);

  return function corsMiddleware(req, res, next) {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;

    if (isOriginAllowed(origin) && origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  };
}
