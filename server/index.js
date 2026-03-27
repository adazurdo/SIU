import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Configuracion del servidor
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server);

const PORT = 3000;

// Servir archivos estaticos desde la carpeta public/
app.use(express.static(join(__dirname, '..', 'public')));

/**
 * Estado global del sistema
 * 
 * Almacena el estado actual que se comparte entre
 * todos los dispositivos conectados.
 */
const systemState = {
  // 'idle' | 'listening' | 'confirming' | 'navigating'
  mode: 'idle',               
  // Ultimo comando de voz reconocido
  lastCommand: null,        
  // Numero de clientes conectados
  connectedClients: 0,      
  // Accion pendiente de confirmacion
  pendingAction: null        
};

// Conexion con Socket.io
io.on('connection', (socket) => {
  systemState.connectedClients++;
  console.log(`[Conexion] Cliente conectado: ${socket.id} (Total: ${systemState.connectedClients})`);

  // Enviar el estado actual al cliente que se acaba de conectar
  socket.emit('system-state', systemState);

  // Evento: comando de voz recibido desde el cliente 
  socket.on('voice-command', (data) => {
    console.log(`[Voz] Comando recibido de ${socket.id}: "${data.command}"`);

    const result = processVoiceCommand(data.command);

    // Actualizar el estado del sistema
    systemState.lastCommand = data.command;
    systemState.mode = result.newMode || systemState.mode;
    systemState.pendingAction = result.pendingAction || null;

    // Enviar resultado al cliente que envio el comando
    socket.emit('action-result', result);

    // Sincronizar estado con todos los clientes conectados
    io.emit('system-state', systemState);
  });

  // Evento: desconexion
  socket.on('disconnect', () => {
    systemState.connectedClients--;
    console.log(`[Desconexion] Cliente desconectado: ${socket.id} (Total: ${systemState.connectedClients})`);
  });
});

// Procesamiento de comandos de voz

/**
 * Procesa un comando de voz y determina la accion a realizar.
 * 
 * Los comandos soportados estan basados en el diseno de la Idea A del proyecto:
 * comandos cortos que no requieren apartar la vista de la carretera.
 * 
 * @param {string} command - El texto del comando reconocido
 * @returns {object} - Resultado con la accion, mensaje y nuevo modo del sistema
 */
function processVoiceCommand(command) {
  const normalizedCommand = command.toLowerCase().trim();

  // Comando: buscar gasolinera
  if (normalizedCommand.includes('buscar gasolinera') || normalizedCommand.includes('gasolinera')) {
    return {
      action: 'search_gas_station',
      message: 'Buscando gasolineras cercanas...',
      newMode: 'confirming',
      pendingAction: 'navigate_to_gas_station'
    };
  }

  // Comando: llamar a alguien
  if (normalizedCommand.includes('llamar a') || normalizedCommand.includes('llama a')) {
    const contactName = normalizedCommand.replace(/llamar a|llama a/g, '').trim();
    return {
      action: 'call_contact',
      message: `Llamando a ${contactName}...`,
      newMode: 'confirming',
      pendingAction: `call_${contactName}`
    };
  }

  // Comando: cancelar accion actual
  if (normalizedCommand.includes('cancelar') || normalizedCommand.includes('cancel')) {
    return {
      action: 'cancel',
      message: 'Accion cancelada.',
      newMode: 'idle',
      pendingAction: null
    };
  }

  // Comando: confirmar accion pendiente
  if (normalizedCommand.includes('confirmar') || normalizedCommand.includes('si') || normalizedCommand.includes('sí')) {
    return {
      action: 'confirm',
      message: 'Accion confirmada.',
      newMode: 'navigating',
      pendingAction: null
    };
  }

  // Comando: repetir ultima indicacion
  if (normalizedCommand.includes('repetir')) {
    return {
      action: 'repeat',
      message: 'Repitiendo ultima indicacion...',
      newMode: systemState.mode
    };
  }

  // Comando no reconocido
  return {
    action: 'unknown',
    message: `Comando no reconocido: "${command}"`,
    newMode: systemState.mode
  };
}

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`Servidor inicializado -> http://localhost:${PORT}`);
});
