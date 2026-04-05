# Contrato De Comandos Y Estados (Backend)

Este documento define el contrato base del backend para voz y estados compartidos.

## Intents Soportados

- navigate_to_destination
- search_gas_station
- call_contact
- cancel
- confirm
- repeat
- unknown
- invalid

## Modos Del Sistema

- idle: sistema en reposo
- listening: modo escucha (reservado para uso futuro en backend)
- confirming: hay accion pendiente de confirmacion
- navigating: navegacion activa o en inicio

## Transiciones Permitidas

- idle -> idle, listening, confirming, navigating
- listening -> idle, listening, confirming, navigating
- confirming -> idle, confirming, navigating
- navigating -> idle, confirming, navigating

Regla de seguridad: si un intent solicita un modo no permitido, el backend mantiene el modo actual.

## Casos Borde Minimos

- confirm sin accion pendiente:
  - respuesta: no hay accion pendiente para confirmar
  - estado: se mantiene el modo actual

- cancel durante navegacion:
  - respuesta: accion cancelada
  - estado: idle
  - actuador: stop_voice_navigation

- cancel sin navegacion activa:
  - respuesta: accion cancelada
  - estado: idle

- repeat sin mensaje previo:
  - respuesta de actuador: no hay indicacion anterior para repetir
  - estado: se mantiene el modo actual

- comando desconocido:
  - respuesta: comando no reconocido
  - estado: se mantiene el modo actual

## Fuente De Verdad En Codigo

La fuente de verdad ejecutable del contrato esta en:

- server/command-contract.js
