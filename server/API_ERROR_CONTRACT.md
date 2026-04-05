# API Error Contract

Formato de error uniforme para endpoints HTTP del backend:

```json
{
  "ok": false,
  "code": "ERROR_CODE",
  "error": "Mensaje legible",
  "details": "(opcional) detalle tecnico"
}
```

## Endpoint: GET /api/geocode

- 400 MISSING_QUERY
- 404 GEOCODE_NOT_FOUND
- 502 GEOCODE_UPSTREAM_UNAVAILABLE
- 502 GEOCODE_UPSTREAM_ERROR
- 504 GEOCODE_TIMEOUT
- 500 GEOCODE_INTERNAL_ERROR

## Endpoint: GET /api/route

- 400 INVALID_ROUTE_COORDS
- 404 ROUTE_NOT_FOUND
- 502 ROUTE_UPSTREAM_BAD_STATUS
- 502 ROUTE_UPSTREAM_ERROR
- 504 ROUTE_TIMEOUT
- 500 ROUTE_INTERNAL_ERROR

## Nota de compatibilidad

Se mantiene la clave `error` como string para no romper el frontend actual.
