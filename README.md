# MotoNav - Sistema de Control para Casco de Moto

Sistema interactivo y ubicuo que permite al motorista controlar funciones de navegacion, llamadas y mas, mediante **comandos de voz** y **gestos de cabeza**, sin soltar las manos del manillar.

Proyecto de la asignatura **Sistemas Interactivos y Ubicuos (SIU)** - UC3M.

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

## Uso

1. Abrir `http://localhost:3000` en el navegador (Chrome recomendado).
2. Pulsar **"Activar microfono"** para iniciar el reconocimiento de voz.
3. Pulsar **"Activar camara"** para iniciar la deteccion de gestos.
4. Decir **"Hey MotoNav"** seguido de un comando (ej: "buscar gasolinera").
5. Confirmar o cancelar con gestos de cabeza (asentir / negar).

## Tecnologias

- **Node.js + Express** - Servidor web
- **Socket.IO** - Comunicacion en tiempo real
- **Web Speech API** - Reconocimiento de voz
- **MediaPipe Face Mesh** - Deteccion de gestos faciales

## Autores

Ada Zurdo, Raoul Vlad Ivaszuk, Jaime Valle, Jorge Gomez,
