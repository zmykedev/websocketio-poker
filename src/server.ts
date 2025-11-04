import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import { connectToDb, getRoomsCollection } from './db.js';
import { v4 as uuid } from 'uuid';
import 'dotenv/config';

import {
  Room,
  RoomDocument,
  User,
  RoomCreateMessage,
  RoomJoinMessage,
  UserVoteMessage,
} from './types.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Crear servidor HTTP y Socket.IO
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

function generateId(): string {
  return uuid();
}

const DEFAULT_EMOJI = '🙂';

function roomDocumentToRoom(doc: RoomDocument): Room {
  return {
    id: doc._id.toString(),
    name: doc.name,
    users: doc.users.map((user) => ({
      ...user,
      emoji: user.emoji || DEFAULT_EMOJI,
    })),
    revealed: doc.revealed,
    cards: doc.cards,
    createdAt: doc.createdAt,
    ownerId: doc.ownerId,
  };
}

// Socket.IO Connection
io.on('connection', (socket: Socket) => {
    let currentUserId: string | null = null;
    let currentRoomId: string | null = null;

  // CREAR SALA
  socket.on('room:create', async (data: RoomCreateMessage) => {
    try {
      const { roomName, ownerName, ownerEmoji, cards } = data;
      
      if (!roomName || !ownerName) {
        socket.emit('room:error', {
          type: 'room:error',
          message: 'Nombre de sala y usuario son requeridos',
        });
        return;
      }
      
      const roomsCol = getRoomsCollection();

            const owner: User = {
              id: generateId(),
              name: ownerName,
        emoji: ownerEmoji || DEFAULT_EMOJI,
              isReady: false,
              vote: null,
              spectator: false,
      };

      const roomId = generateId();
      const room: RoomDocument = {
        _id: roomId,
              name: roomName,
              ownerId: owner.id,
              users: [owner],
              revealed: false,
        cards: cards || [],
              createdAt: Date.now(),
      };

      await roomsCol.insertOne(room);

            currentUserId = owner.id;
      currentRoomId = roomId;

      // Unirse al room de Socket.IO
      socket.join(currentRoomId);

      // Enviar confirmación al creador
      socket.emit('room:created', {
              type: 'room:created',
        room: roomDocumentToRoom(room),
              ownerId: owner.id,
      });
    } catch (error) {
      socket.emit('room:error', {
        type: 'room:error',
        message: error instanceof Error ? error.message : 'Error al crear la sala',
      });
    }
  });

  // UNIRSE A SALA
  socket.on('room:join', async (data: RoomJoinMessage) => {
    try {
      const { roomId, userName, emoji } = data;

      const roomsCol = getRoomsCollection();
      const room = await roomsCol.findOne({ _id: roomId });

            if (!room) {
        socket.emit('room:error', {
                type: 'room:error',
          message: 'Sala no encontrada',
        });
        return;
            }

            const user: User = {
              id: generateId(),
              name: userName,
        emoji: emoji || DEFAULT_EMOJI,
              isReady: false,
              vote: null,
              spectator: false,
      };

      const updatedRoom = await roomsCol.findOneAndUpdate(
        { _id: roomId },
        { $push: { users: user } },
        { returnDocument: 'after' }
      );

            if (!updatedRoom) {
        socket.emit('room:error', {
                type: 'room:error',
          message: 'Error al unirse a la sala',
        });
        return;
      }

            currentUserId = user.id;
            currentRoomId = updatedRoom._id.toString();

      // Unirse al room de Socket.IO
      socket.join(currentRoomId);

      // Enviar confirmación al usuario
      socket.emit('room:joined', {
              type: 'room:joined',
              room: roomDocumentToRoom(updatedRoom),
              userId: user.id,
            });

      // Broadcast a todos en la sala
      socket.to(currentRoomId).emit('room:updated', {
                type: 'room:updated',
                room: roomDocumentToRoom(updatedRoom),
      });
    } catch (error) {
      socket.emit('room:error', {
                type: 'room:error',
        message: 'Error al unirse a la sala',
      });
    }
  });

  // VOTAR
  socket.on('user:vote', async (data: UserVoteMessage) => {
    try {
      const { vote } = data;

      if (!currentRoomId || !currentUserId) {
        socket.emit('room:error', {
          type: 'room:error',
          message: 'No estás en una sala',
        });
        return;
      }

      const roomsCol = getRoomsCollection();
      const room = await roomsCol.findOne({ _id: currentRoomId });

      if (!room) {
        socket.emit('room:error', {
          type: 'room:error',
          message: 'Sala no encontrada',
        });
        return;
      }

      // Verificar si el usuario es espectador
      const user = room.users.find((u) => u.id === currentUserId);
      if (user?.spectator) {
        socket.emit('room:error', {
          type: 'room:error',
          message: 'Los espectadores no pueden votar',
        });
        return;
      }

      const updatedRoom = await roomsCol.findOneAndUpdate(
        {
          _id: currentRoomId,
          'users.id': currentUserId,
        },
        { $set: { 'users.$.vote': vote, 'users.$.isReady': true } },
        { returnDocument: 'after' }
      );

      if (!updatedRoom) {
        socket.emit('room:error', {
          type: 'room:error',
          message: 'Error al registrar el voto',
        });
        return;
      }

      // Broadcast a toda la sala (incluyendo el votante)
      io.to(currentRoomId).emit('room:updated', {
        type: 'room:updated',
        room: roomDocumentToRoom(updatedRoom),
      });
    } catch (error) {
      socket.emit('room:error', {
        type: 'room:error',
        message: 'Error al registrar el voto',
      });
    }
  });

  // CAMBIAR MODO ESPECTADOR
  socket.on('user:spectate', async (data: { spectator: boolean }) => {
    try {
      const { spectator } = data;

      if (!currentRoomId || !currentUserId) {
        socket.emit('room:error', {
          type: 'room:error',
          message: 'No estás en una sala',
        });
        return;
      }

      const roomsCol = getRoomsCollection();
      const room = await roomsCol.findOne({ _id: currentRoomId });

      if (!room) {
        socket.emit('room:error', {
          type: 'room:error',
          message: 'Sala no encontrada',
        });
        return;
      }

      // Verificar que el usuario NO sea el owner
      if (room.ownerId === currentUserId) {
        socket.emit('room:error', {
          type: 'room:error',
          message: 'El creador de la sala no puede ser espectador',
        });
        return;
      }

      // Si se activa modo espectador, limpiar el voto
      const updateData = spectator
        ? { 'users.$.spectator': spectator, 'users.$.vote': null, 'users.$.isReady': false }
        : { 'users.$.spectator': spectator };

      const updatedRoom = await roomsCol.findOneAndUpdate(
        {
          _id: currentRoomId,
          'users.id': currentUserId,
        },
        { $set: updateData },
        { returnDocument: 'after' }
      );

      if (!updatedRoom) {
        socket.emit('room:error', {
          type: 'room:error',
          message: 'Error al cambiar modo espectador',
        });
        return;
      }

      // Broadcast a toda la sala
      io.to(currentRoomId).emit('room:updated', {
        type: 'room:updated',
        room: roomDocumentToRoom(updatedRoom),
      });
    } catch (error) {
      socket.emit('room:error', {
        type: 'room:error',
        message: 'Error al cambiar modo espectador',
      });
    }
  });

  // REVELAR VOTOS
  socket.on('room:reveal', async () => {
    try {
      if (!currentRoomId || !currentUserId) {
        socket.emit('room:error', {
          type: 'room:error',
          message: 'No estás en una sala',
        });
        return;
      }

      const roomsCol = getRoomsCollection();
      const room = await roomsCol.findOne({ _id: currentRoomId });

      if (!room) {
        socket.emit('room:error', {
          type: 'room:error',
          message: 'Sala no encontrada',
        });
        return;
      }

      if (room.ownerId !== currentUserId) {
        socket.emit('room:error', {
                type: 'room:error',
          message: 'Solo el moderador puede revelar los votos',
        });
        return;
            }

      const updatedRoom = await roomsCol.findOneAndUpdate(
        { _id: currentRoomId },
        { $set: { revealed: true } },
              { returnDocument: 'after' }
            );

            if (!updatedRoom) {
        socket.emit('room:error', {
                type: 'room:error',
          message: 'Error al revelar votos',
        });
        return;
      }

      // Broadcast a toda la sala
      io.to(currentRoomId).emit('room:updated', {
                type: 'room:updated',
                room: roomDocumentToRoom(updatedRoom),
      });
    } catch (error) {
      socket.emit('room:error', {
        type: 'room:error',
        message: 'Error al revelar votos',
      });
    }
  });

  // REINICIAR VOTACIÓN
  socket.on('room:reset', async () => {
    try {
            if (!currentRoomId || !currentUserId) {
        socket.emit('room:error', {
                type: 'room:error',
          message: 'No estás en una sala',
        });
        return;
      }

      const roomsCol = getRoomsCollection();
      const room = await roomsCol.findOne({ _id: currentRoomId });

            if (!room) {
        socket.emit('room:error', {
                type: 'room:error',
          message: 'Sala no encontrada',
        });
        return;
            }

            if (room.ownerId !== currentUserId) {
        socket.emit('room:error', {
                type: 'room:error',
          message: 'Solo el moderador puede reiniciar la votación',
        });
        return;
      }

      const resetUsers = room.users.map((user) => ({
        ...user,
        vote: null,
        isReady: false,
      }));

      const updatedRoom = await roomsCol.findOneAndUpdate(
        { _id: currentRoomId },
        { $set: { revealed: false, users: resetUsers } },
              { returnDocument: 'after' }
            );

      if (!updatedRoom) {
        socket.emit('room:error', {
                type: 'room:error',
          message: 'Error al reiniciar votación',
        });
        return;
      }

      // Broadcast a toda la sala
      io.to(currentRoomId).emit('room:updated', {
                type: 'room:updated',
        room: roomDocumentToRoom(updatedRoom),
      });
    } catch (error) {
      socket.emit('room:error', {
        type: 'room:error',
        message: 'Error al reiniciar votación',
      });
    }
  });

  // DESCONEXIÓN
  socket.on('disconnect', async () => {
    if (!currentUserId || !currentRoomId) return;

    try {
      const roomsCol = getRoomsCollection();
      const room = await roomsCol.findOne({ _id: currentRoomId });

      if (!room) return;

      const updatedUsers = room.users.filter((u) => u.id !== currentUserId);

      if (updatedUsers.length === 0) {
        await roomsCol.deleteOne({ _id: currentRoomId });
        return;
      }

      let newOwnerId = room.ownerId;
      if (room.ownerId === currentUserId && updatedUsers.length > 0) {
        newOwnerId = updatedUsers[0].id;
      }

      const updatedRoom = await roomsCol.findOneAndUpdate(
        { _id: currentRoomId },
        { $set: { users: updatedUsers, ownerId: newOwnerId } },
        { returnDocument: 'after' }
      );

      if (updatedRoom) {
        io.to(currentRoomId).emit('room:updated', {
          type: 'room:updated',
          room: roomDocumentToRoom(updatedRoom),
        });
      }
    } catch (error) {
      // Silent cleanup
    }
  });
});

// REST API
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/rooms', async (req, res) => {
  try {
    const roomsCol = getRoomsCollection();
    const rooms = await roomsCol.find({}).toArray();
    const roomsData = rooms.map((r) => roomDocumentToRoom(r));
    res.json({ rooms: roomsData });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching rooms' });
  }
});

app.get('/rooms/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const roomsCol = getRoomsCollection();
    const room = await roomsCol.findOne({ _id: roomId });

    if (!room) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }

    res.json({ room: roomDocumentToRoom(room) });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching room' });
  }
});

// Iniciar servidor
async function startServer() {
  try {
    await connectToDb();
    httpServer.listen(PORT);
  } catch (error) {
    process.exit(1);
  }
}

startServer();
