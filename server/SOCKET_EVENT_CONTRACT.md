# Socket Event Contract (Backend)

Contrato estandar de eventos Socket emitidos por backend.

## 1) system-state

Evento: `system-state`

```json
{
  "ok": true,
  "event": "system-state",
  "data": {
    "mode": "idle|listening|confirming|navigating",
    "lastCommand": "string|null",
    "connectedClients": 1,
    "pendingAction": { "type": "...", "payload": {} } 
  },
  "mode": "...",
  "lastCommand": "...",
  "connectedClients": 1,
  "pendingAction": null
}
```

Notas:
- Los campos fuera de `data` se mantienen por compatibilidad con el frontend actual.

## 2) action-result

Evento: `action-result`

```json
{
  "ok": true,
  "event": "action-result",
  "code": "string|null",
  "data": {
    "action": "...",
    "message": "...",
    "newMode": "..."
  },
  "action": "...",
  "message": "...",
  "newMode": "..."
}
```

Notas:
- `ok=false` para `invalid` y `unknown`.
- Campos planos se mantienen por compatibilidad.

## 3) actuator-exec

Evento: `actuator-exec`

```json
{
  "ok": true,
  "event": "actuator-exec",
  "data": {
    "type": "string",
    "payload": {}
  },
  "type": "string",
  "payload": {}
}
```

## 4) actuator-status-ack

Evento: `actuator-status-ack`

```json
{
  "ok": true,
  "event": "actuator-status-ack",
  "code": "ACTUATOR_STATUS_OK|ACTUATOR_STATUS_ERROR",
  "message": "...",
  "data": {
    "status": "ok|error",
    "message": "..."
  },
  "status": "ok|error",
  "message": "..."
}
```

## 5) voice-command (entrada validada)

Entrada esperada desde cliente:

```json
{
  "command": "texto"
}
```

Validaciones:
- payload objeto
- `command` no vacio
- longitud maxima: 180
