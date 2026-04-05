/**
 * Construye una respuesta de error API uniforme sin romper el frontend actual.
 *
 * @param {import('express').Response} res
 * @param {{ status: number, code: string, message: string, details?: string }} payload
 */
export function sendApiError(res, payload) {
  const body = {
    ok: false,
    code: payload.code,
    error: payload.message
  };

  if (payload.details) {
    body.details = payload.details;
  }

  res.status(payload.status).json(body);
}
