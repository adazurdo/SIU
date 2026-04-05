/**
 * Rate limiter simple en memoria para entorno educativo.
 *
 * @param {{ windowMs: number, maxRequests: number }} options
 */
export function createRateLimiter(options) {
  const windowMs = Number(options.windowMs || 60000);
  const maxRequests = Number(options.maxRequests || 60);
  const buckets = new Map();

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const ip = readClientIp(req);
    const path = String(req.path || '');
    const key = `${ip}:${path}`;

    const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }

    bucket.count += 1;
    buckets.set(key, bucket);

    if (bucket.count > maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        ok: false,
        code: 'RATE_LIMITED',
        error: 'Demasiadas solicitudes. Intenta de nuevo en unos segundos.',
        details: `retry_after=${retryAfterSec}s`
      });
      return;
    }

    next();
  };
}

/**
 * @param {import('express').Request} req
 */
function readClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];

  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || 'unknown';
}
