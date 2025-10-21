import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { connectToDb, getRoomsCollection } from './db.js';
import { v4 as uuid } from 'uuid'

import 'dotenv/config'

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const userSockets = new Map();

function generateId() {
  return uuid()
}

function isWsOpen(ws) {
  return ws && ws.readyState === 1;
}

async function broadcast(room, message, excludeUserId = null) {
  if (!room) return;
  for (const user of room.users || []) {
    if (excludeUserId && user.id === excludeUserId) continue;
    const ws = userSockets.get(user.id);
    if (isWsOpen(ws)) {
      try {
        ws.send(JSON.stringify(message));
      } catch (e) {
        // TODO: implement error handling
      }
    }
  }
}

function broadcastToUser(userId, message) {
  const ws = userSockets.get(userId);
  if (isWsOpen(ws)) {
    try {
      ws.send(JSON.stringify(message));
    } catch {}
  }
}

async function cleanupUser(userId) {
  userSockets.delete(userId);
  const roomsCol = getRoomsCollection();

  const cursor = roomsCol.find({ 'users.id': userId });
  const affectedRooms = await cursor.toArray();

  for (const room of affectedRooms) {
    const pulled = await roomsCol.findOneAndUpdate(
      { _id: room._id },
      { $pull: { users: { id: userId } } },
      { returnDocument: 'after' }
    );

    const updated = pulled.value;
    if (!updated) continue;

    if (!updated.users || updated.users.length === 0) {
      await roomsCol.deleteOne({ _id: updated._id });
      console.log(`🗑️  Sala ${updated._id} eliminada (vacía)`);
      continue;
    }

    if (!updated.users.some(u => u.isModerator)) {
      await roomsCol.updateOne(
        { _id: updated._id },
        { $set: { 'users.0.isModerator': true } }
      );
      updated.users[0].isModerator = true;
      console.log(`👑 Nuevo moderador en sala ${updated._id}: ${updated.users[0].name}`);
    }

    await broadcast(updated, { type: 'room:updated', room: toRoomDto(updated) });
  }
}

function toRoomDto(doc) {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return { id: _id, ...rest };
}

async function start() {
  await connectToDb();
  const roomsCol = getRoomsCollection();

  await roomsCol.createIndex({ 'users.id': 1 });

  const server = app.listen(PORT, () => {
    console.log(`🚀 Servidor HTTP escuchando en http://localhost:${PORT}`);
  });

  const wss = new WebSocketServer({ server });
  console.log('🔌 Servidor WebSocket listo');

  wss.on('connection', (ws) => {
    console.log('✅ Nueva conexión WebSocket');
    let currentUserId = null;
    let currentRoomId = null;

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('📨 Mensaje recibido:', message.type);

        switch (message.type) {
          case 'room:create': {
            const { roomName, userName, cardDeck } = message;
            const roomId = generateId();
            const userId = generateId();

            const moderator = {
              id: userId,
              name: userName,
              isReady: false,
              vote: null,
              isModerator: true,
            };

            const roomDoc = {
              _id: roomId,
              name: roomName,
              users: [moderator],
              revealed: false,
              cardDeck,
              createdAt: Date.now(),
            };

            await roomsCol.insertOne(roomDoc);

            userSockets.set(userId, ws);
            currentUserId = userId;
            currentRoomId = roomId;

            const room = toRoomDto(roomDoc);
            broadcastToUser(userId, { type: 'room:created', room, userId });
            console.log(`🏠 Sala creada: ${roomName} (${roomId}) por ${userName}`);
            break;
          }

          case 'room:join': {
            const { roomId, userName } = message;
            const existing = await roomsCol.findOne({ _id: roomId });
            if (!existing) {
              ws.send(JSON.stringify({ type: 'room:error', message: 'Sala no encontrada' }));
              break;
            }

            const userId = generateId();
            const user = { id: userId, name: userName, isReady: false, vote: null, isModerator: false };

            const updated = await roomsCol.findOneAndUpdate(
              { _id: roomId },
              { $push: { users: user } },
              { returnDocument: 'after' }
            );

            userSockets.set(userId, ws);
            currentUserId = userId;
            currentRoomId = roomId;

            const room = toRoomDto(updated);
            broadcastToUser(userId, { type: 'room:joined', room, userId });
            await broadcast(room, { type: 'room:updated', room }, userId);
            console.log(`👤 ${userName} se unió a la sala ${roomId}`);
            break;
          }

          case 'user:vote': {
            const { vote } = message;
            if (!currentRoomId || !currentUserId) break;

            const res = await roomsCol.updateOne(
              { _id: currentRoomId, 'users.id': currentUserId },
              { $set: { 'users.$.vote': vote, 'users.$.isReady': true } }
            );
            if (res.matchedCount === 0) break;
            const roomDoc = await roomsCol.findOne({ _id: currentRoomId });
            const room = toRoomDto(roomDoc);
            await broadcast(room, { type: 'room:updated', room });
            const user = room.users.find(u => u.id === currentUserId);
            console.log(`🗳️  ${user?.name ?? currentUserId} votó: ${vote}`);
            break;
          }

          case 'room:reveal': {
            if (!currentRoomId || !currentUserId) break;
            const roomDoc = await roomsCol.findOne({ _id: currentRoomId });
            if (!roomDoc) break;
            const user = roomDoc.users.find(u => u.id === currentUserId);
            if (!user || !user.isModerator) {
              ws.send(JSON.stringify({ type: 'room:error', message: 'Solo el moderador puede revelar los votos' }));
              break;
            }
            await roomsCol.updateOne({ _id: currentRoomId }, { $set: { revealed: true } });
            const updated = await roomsCol.findOne({ _id: currentRoomId });
            const room = toRoomDto(updated);
            await broadcast(room, { type: 'room:revealed' });
            await broadcast(room, { type: 'room:updated', room });
            console.log(`👁️  Votos revelados en sala ${currentRoomId}`);
            break;
          }

          case 'room:reset': {
            if (!currentRoomId || !currentUserId) break;
            const roomDoc = await roomsCol.findOne({ _id: currentRoomId });
            if (!roomDoc) break;
            const user = roomDoc.users.find(u => u.id === currentUserId);
            if (!user || !user.isModerator) {
              ws.send(JSON.stringify({ type: 'room:error', message: 'Solo el moderador puede reiniciar la votación' }));
              break;
            }
            await roomsCol.updateOne(
              { _id: currentRoomId },
              { $set: { 'users.$[].vote': null, 'users.$[].isReady': false, revealed: false } }
            );
            const updated = await roomsCol.findOne({ _id: currentRoomId });
            const room = toRoomDto(updated);
            await broadcast(room, { type: 'room:reset' });
            await broadcast(room, { type: 'room:updated', room });
            console.log(`🔄 Votación reiniciada en sala ${currentRoomId}`);
            break;
          }

          default:
            console.log('⚠️  Tipo de mensaje desconocido:', message.type);
        }
      } catch (error) {
        console.error('❌ Error procesando mensaje:', error);
        try {
          ws.send(JSON.stringify({ type: 'error', message: 'Error del servidor' }));
        } catch {}
      }
    });

    ws.on('close', () => {
      console.log('❌ Conexión WebSocket cerrada');
      if (currentUserId) {
        cleanupUser(currentUserId).catch(err => console.error('cleanupUser error', err));
      }
    });

    ws.on('error', (error) => {
      console.error('❌ Error WebSocket:', error);
    });
  });

  app.get('/health', async (req, res) => {
    try {
      const rooms = await roomsCol.countDocuments();
      res.json({ status: 'ok', rooms, connections: userSockets.size, timestamp: new Date().toISOString() });
    } catch (e) {
      res.status(500).json({ status: 'error', message: 'No se pudo obtener health' });
    }
  });

  app.get('/rooms', async (req, res) => {
    try {
      const docs = await roomsCol.find({}, { projection: { users: 1, name: 1, cardDeck: 1 } }).toArray();
      const list = docs.map(d => ({ id: d._id, name: d.name, users: (d.users || []).length, revealed: !!d.revealed, cardDeck: d.cardDeck?.name }));
      res.json(list);
    } catch (e) {
      res.status(500).json({ error: 'No se pudo listar salas' });
    }
  });

  process.on('uncaughtException', (error) => {
    console.error('❌ Error no capturado:', error);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('❌ Promise rechazada no manejada:', reason);
  });

  console.log('✨ Servidor de Planning Poker iniciado con MongoDB');
}

start().catch(err => {
  console.error('No se pudo iniciar el servidor:', err);
  process.exit(1);
});
