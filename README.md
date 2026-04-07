# MotoNav - Sistema de Control para Casco de Moto

Sistema interactivo y ubicuo que permite al motorista controlar funciones de navegacion, llamadas y mas, mediante **comandos de voz** y **gestos de cabeza**, sin soltar las manos del manillar.

La interfaz se distribuye ahora en dos pantallas:

- `pilot`: HUD principal para el motorista
- `companion`: segunda pantalla para control remoto y monitorizacion del sistema

Proyecto de la asignatura **Sistemas Interactivos y Ubicuos (SIU)** - UC3M.

## Estado Actual Del Backend

El backend esta implementado como un orquestador modular en `server/index.js` con estos bloques:

- Parser de comandos de voz y sanitizacion de payloads.
- Maquina de estados del sistema (`idle`, `listening`, `confirming`, `navigating`).
- Servicios externos para geocodificacion y calculo de ruta.
- Contrato estandar de errores HTTP.
- Contrato estandar de eventos Socket.
- Seguridad base (rate limit + CORS configurable + validacion de payloads).
- Observabilidad con logs estructurados JSON.

Tambien soporta alcance de estado configurable:

- `global` (por defecto): todos los clientes comparten estado.
- `socket`: cada cliente mantiene su propio estado.

## Requisitos

- [Node.js](https://nodejs.org/) (v18 o superior)
- Navegador con soporte para Web Speech API y WebRTC 

## Instalacion

Instalar las dependencias: 

```bash
npm install
```

## Ejecucion

```bash
npm start
```

El servidor escucha en `http://localhost:3000`.

## Variables De Entorno

- `SIU_STATE_SCOPE`
	- `global` (default): estado compartido entre clientes.
	- `socket`: estado independiente por conexion.
- `SIU_ALLOWED_ORIGINS`
	- Lista CSV de origenes permitidos para CORS.
	- Ejemplo: `http://localhost:3000,http://127.0.0.1:3000`

Si no se define `SIU_ALLOWED_ORIGINS`, se usan los origenes locales por defecto.

Ejemplo en PowerShell:

```powershell
$env:SIU_STATE_SCOPE="socket"
$env:SIU_ALLOWED_ORIGINS="http://localhost:3000,http://127.0.0.1:3000"
npm start
```

## API HTTP Del Backend

### `GET /api/geocode`

- Entrada: `query` (texto libre).
- Salida OK: `{ lat, lon, name }`.
- Errores principales:
	- `400 MISSING_QUERY`
	- `404 GEOCODE_NOT_FOUND`
	- `502 GEOCODE_UPSTREAM_UNAVAILABLE | GEOCODE_UPSTREAM_ERROR`
	- `504 GEOCODE_TIMEOUT`

### `GET /api/route`

- Entrada: `origin=lat,lon` y `destination=lat,lon`.
- Salida OK: `{ distance, duration, steps[] }`.
- Errores principales:
	- `400 INVALID_ROUTE_COORDS`
	- `404 ROUTE_NOT_FOUND`
	- `502 ROUTE_UPSTREAM_BAD_STATUS | ROUTE_UPSTREAM_ERROR`
	- `504 ROUTE_TIMEOUT`

### Formato De Error HTTP

```json
{
	"ok": false,
	"code": "ERROR_CODE",
	"error": "Mensaje legible",
	"details": "(opcional) detalle tecnico"
}
```

## Socket.IO (Backend)

Eventos emitidos por backend:

- `system-state`
- `action-result`
- `actuator-exec`
- `actuator-status-ack`

Eventos recibidos desde cliente:

- `voice-command`
- `actuator-status`

Los eventos se emiten con una estructura estandar (`ok`, `event`, `data`) manteniendo campos legacy para compatibilidad con el frontend actual.

## Seguridad Y Operacion

- **Rate limiting** en endpoints HTTP (60 req/min por IP+ruta).
- **CORS configurable** por lista de origenes permitidos.
- **Validacion de payload** en comandos de voz y estado de actuadores.
- **Logs estructurados** en formato JSON para trazabilidad.

## Uso

1. Abrir una pantalla `pilot` en `http://localhost:3000/?role=pilot`.
2. Abrir una segunda pantalla `companion` en `http://localhost:3000/?role=companion`.
3. En `pilot`, pulsar **"Activar microfono"** para iniciar el reconocimiento de voz.
4. En `pilot`, pulsar **"Activar camara"** para iniciar la deteccion de gestos.
5. Probar comandos por voz en `pilot` o enviar comandos remotos desde `companion`.

Flujos recomendados:

- `pilot`: HUD completo con voz, gestos y navegacion
- `companion`: comandos rapidos, estado sincronizado y listado de pantallas conectadas

## Tecnologias

- **Node.js + Express** - Servidor web
- **Socket.IO** - Comunicacion en tiempo real
- **Web Speech API** - Reconocimiento de voz
- **MediaPipe Face Mesh** - Deteccion de gestos faciales

## Documentacion Tecnica Del Backend

- `server/COMMAND_CONTRACT.md`
- `server/API_ERROR_CONTRACT.md`
- `server/SOCKET_EVENT_CONTRACT.md`
- `server/BACKEND_SMOKE_CHECKLIST.md`

## Autores

Ada Zurdo, Raoul Vlad Ivaszuk, Jaime Valle, Jorge Gomez,
