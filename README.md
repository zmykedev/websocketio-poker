# Planning Poker Server

Backend con WebSocket real para la aplicación de Planning Poker, ahora con persistencia en MongoDB y **TypeScript**.

## 🚀 Instalación

Usa tu gestor preferido (pnpm recomendado porque hay pnpm-lock.yaml) : 

```bash
# con pnpm
pnpm install

# o con npm
npm install
```

## 📝 Uso

Asegúrate de definir las variables de entorno (ver sección Variables de Entorno) antes de arrancar.

### Modo Desarrollo (con auto-reload)
```bash
pnpm dev
# o
npm run dev
```

### Compilar TypeScript
```bash
pnpm build
# o
npm run build
```

### Modo Producción
```bash
# Primero compilar
pnpm build
# Luego ejecutar
pnpm start
# o
npm start
```

### Verificar tipos sin compilar
```bash
pnpm typecheck
# o
npm run typecheck
```

El servidor estará disponible en:
- HTTP: http://localhost:3001
- WebSocket: ws://localhost:3001

## 🔧 Estructura del Proyecto

```
src/
  ├── server.ts    # Servidor principal con WebSocket
  ├── db.ts        # Conexión a MongoDB
  └── types.ts     # Tipos TypeScript
dist/              # Archivos compilados (generados por tsc)
```

## 🔌 Socket.IO en Producción

El servidor expone un **namespace único** en `ws://localhost:3001` (mismo host que HTTP) y utiliza **Socket.IO** sobre websockets. Acepta conexiones CORS desde cualquier origen (`origin: '*'`), por lo que el frontend solo necesita apuntar al host correcto. No hay autenticación en la conexión por defecto; toda la autorización se maneja a nivel de eventos.

### Flujo típico de conexión
- El cliente inicializa `socket.io-client` apuntando al backend (`io('http://localhost:3001')`).
- El servidor responde con el `socket.id` y mantiene la conexión viva con pings automáticos.
- Para crear una sala, el cliente emite `room:create` con `roomName`, `ownerName`, `ownerEmoji` y `cards`. El backend crea la sala, asigna un `ownerId`, persiste en MongoDB y envía `room:created`.
- Para unirse, el cliente emite `room:join` con `roomId`, `userName` y un `emoji` opcional. El servidor agrega al usuario, une el socket a la room interna y devuelve `room:joined` con el estado completo.
- A partir de ahí, cualquier cambio (votos, revelar, reset, desconexión, reasignación de moderador) se publica como `room:updated` al **room de Socket.IO**, por lo que todos los clientes reciben el estado completo y re-renderizan sin lógica de sincronización extra.

### Eventos aceptados por el servidor
- `room:create`: crea una sala nueva y devuelve `room:created` con `room` y `ownerId`.
- `room:join`: agrega un usuario y devuelve `room:joined` con `room` y `userId`.
- `user:vote`: actualiza `vote` e `isReady` y emite `room:updated` a toda la sala.
- `room:reveal`: (solo moderador) marca `revealed` en `true` y dispara `room:updated`.
- `room:reset`: (solo moderador) limpia votos y `isReady`, vuelve a `revealed: false` y emite `room:updated`.

### Eventos emitidos por el servidor
- `room:created`: respuesta directa al creador con el estado inicial.
- `room:joined`: respuesta directa al usuario que se suma.
- `room:updated`: broadcast a toda la sala con el estado completo sincronizado desde MongoDB.
- `room:error`: respuesta directa al socket que generó la acción con el motivo del fallo.

### Ejemplo de integración frontend (React + TypeScript)
```tsx
import { useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';

type RoomState = {
  id: string;
  name: string;
  users: Array<{ id: string; name: string; emoji: string; isReady: boolean; vote: number | null; spectator: boolean }>;
  revealed: boolean;
  cards: string[];
  ownerId: string;
};

export function usePlanningSocket(roomId?: string) {
  const socket = useMemo<Socket>(() => io('http://localhost:3001', { autoConnect: false }), []);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    socket.connect();
    setStatus('connecting');

    const handleConnect = () => setStatus('connected');
    const handleDisconnect = () => setStatus('disconnected');
    const handleRoom = ({ room: payload }: { room: RoomState }) => setRoom(payload);
    const handleError = ({ message }: { message: string }) => setLastError(message);

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('room:created', handleRoom);
    socket.on('room:joined', handleRoom);
    socket.on('room:updated', handleRoom);
    socket.on('room:error', handleError);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('room:created', handleRoom);
      socket.off('room:joined', handleRoom);
      socket.off('room:updated', handleRoom);
      socket.off('room:error', handleError);
      socket.disconnect();
    };
  }, [socket]);

  const createRoom = (payload: { roomName: string; ownerName: string; ownerEmoji?: string; cards?: string[] }) => {
    socket.emit('room:create', payload);
  };

  const joinRoom = (payload: { userName: string; emoji?: string }) => {
    if (!roomId) return;
    socket.emit('room:join', { roomId, ...payload });
  };

  const sendVote = (vote: number | null) => socket.emit('user:vote', { vote });
  const revealVotes = () => socket.emit('room:reveal');
  const resetVotes = () => socket.emit('room:reset');

  return { room, status, lastError, createRoom, joinRoom, sendVote, revealVotes, resetVotes };
}
```

Sugerencias frontend:
- Persistir `roomId` y `userId` en `localStorage` o en una store (Zustand) para rehidratar tras recargas.
- Controlar reconexiones automáticas (`reconnection: true`) para que Socket.IO recupere una sesión perdida.
- Deshabilitar botones de acción según `room.ownerId`, `revealed` o `isReady` para reforzar reglas del servidor.

## 🌐 API REST

### GET /health
Verifica el estado del servidor.

### GET /rooms
Lista todas las salas activas (conteo de usuarios, mazo, etc.).

## 📦 Persistencia y Modelo

- Colección: rooms
- Estructura (resumen):
  - _id: string (igual al id de la sala)
  - name: string
  - users: Array<{ id, name, isReady, vote, isModerator }>
  - revealed: boolean
  - cardDeck: { id, name, values }
  - createdAt: number (epoch ms)

Se crea un índice en `users.id` para acelerar limpiezas al desconectar usuarios.

## 🔐 Variables de Entorno

Crea un archivo `.env` en la raíz del proyecto:

```env
MONGO_URL=mongodb://localhost:27017
DB_NAME=planning-poker
PORT=3001
```

## 🛠️ Stack Tecnológico

- **Node.js** con **TypeScript**
- **Express** (API REST)
- **WebSocket (ws)** (comunicación en tiempo real)
- **MongoDB** (persistencia)
- **tsx** (desarrollo con hot-reload)

## 🏗️ Características

- ✅ WebSocket real con reconexión en cliente
- ✅ Persistencia de salas en MongoDB (sin almacenamiento en memoria)
- ✅ Limpieza automática de usuarios desconectados y reasignación de moderador
- ✅ Validaciones de permisos (solo moderador puede revelar/reiniciar)
- ✅ API REST para monitoreo
- ✅ Logs detallados
- ✅ Manejo robusto de errores

## 🛡️ Seguridad

Para producción, considera:
- Rate limiting
- Autenticación de usuarios
- Validación de datos
- HTTPS/WSS
- Copias de seguridad de MongoDB y rotación de credenciales
