# Backend Smoke Checklist (Manual)

Prerequisitos:
- Servidor arrancado con `npm start`
- Cliente web abierto en navegador

## A. API HTTP

1. Geocode sin query
- URL: `/api/geocode`
- Esperado: `400`, `code=MISSING_QUERY`

2. Geocode destino valido
- URL: `/api/geocode?query=universidad%20carlos%20iii%20leganes`
- Esperado: `200` con `lat/lon/name`

3. Route coordenadas invalidas
- URL: `/api/route?origin=x,y&destination=1,2`
- Esperado: `400`, `code=INVALID_ROUTE_COORDS`

4. Route valida
- URL: `/api/route?origin=40.332,-3.766&destination=40.339,-3.764`
- Esperado: `200` con `steps`

5. Rate limit
- Lanzar >60 peticiones/min a una API
- Esperado: `429`, `code=RATE_LIMITED`

## B. Socket + Voz

1. Comando invalido (payload incorrecto)
- Emitir `voice-command` con payload no objeto
- Esperado: `action-result` con `action=invalid`

2. Comando vacio
- Emitir `voice-command` con `command="   "`
- Esperado: `action-result` invalid

3. Cancelar
- Decir `cancelar`
- Esperado: `action-result` cancel + modo `idle`

4. Confirmar sin pendiente
- Decir `confirmar` sin llamada pendiente
- Esperado: mensaje "No hay ninguna accion pendiente para confirmar"

5. Repetir
- Decir `repetir`
- Esperado: `action-result` repeat y actuador inmediato

## C. Scope de estado multi-cliente

1. Modo global (default)
- Variable: `SIU_STATE_SCOPE=global` o sin definir
- Esperado: cambios de estado sincronizados a todos los clientes

2. Modo por socket
- Variable: `SIU_STATE_SCOPE=socket`
- Esperado: cada cliente mantiene su propio estado

## D. CORS

1. Origen permitido
- Definir `SIU_ALLOWED_ORIGINS` incluyendo origen cliente
- Esperado: acceso permitido

2. Origen no permitido
- Hacer request desde origen no listado
- Esperado: browser bloquea por CORS
