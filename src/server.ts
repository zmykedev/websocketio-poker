import express from 'express';
import cors from 'cors';
import { WebSocket, WebSocketServer } from 'ws';
import { connectToDb, getRoomsCollection } from './db.js';
import { v4 as uuid } from 'uuid';
import 'dotenv/config';

import {
  BroadcastMessage,
  ExtendedWebSocket,
  IncomingMessage,
  Room,
  RoomCreatedMessage,
  RoomCreateMessage,
  RoomDocument,
  RoomJoinedMessage,
  RoomJoinMessage,
  RoomUpdatedMessage,
  User, UserVoteMessage, WebSocketMessage,
} from './types.js';
import {ObjectId} from "mongodb";
import { Request, Response } from 'express'

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const userSockets = new Map<string, ExtendedWebSocket>();

function generateId(): string {
  return uuid();
}

function isWsOpen(ws: WebSocket | undefined): boolean {
  return !!ws && ws.readyState === WebSocket.OPEN;
}

async function broadcast<MessageType extends WebSocketMessage>({
  room,
  message,
  excludeUserId,
}: BroadcastMessage<MessageType>): Promise<void> {
  if (!room) return;

  for (const user of room.users || []) {
    if (excludeUserId && user.id === excludeUserId) continue;

    const ws = userSockets.get(user.id);

    if (isWsOpen(ws)) {
      try {
        ws!.send(JSON.stringify(message));
      } catch (e) {
        console.error(`❌  Error enviando mensaje al usuario ${user.id}:`, e);
      }
    }
  }
}

function broadcastToUser<MessageType>(userId: string, message: MessageType): void {
  const ws = userSockets.get(userId);
  if (isWsOpen(ws)) {
    try {
      ws!.send(JSON.stringify(message));
    } catch {
      console.error(`❌  Error enviando mensaje al usuario ${userId}`);
    }
  }
}

async function cleanupUser({ uid }: { uid: string }): Promise<void> {
  userSockets.delete(uid);
  const roomsCol = getRoomsCollection();

  const affectedRooms = await roomsCol
    .find({ 'users.id': uid })
    .toArray();

  console.log(`🧹  Limpiando usuario ${uid} de ${affectedRooms.length} salas`);

  for (const room of affectedRooms) {
    const updated = await roomsCol.findOneAndUpdate({
      _id: room._id,
    }, {
      $pull: {
        users: {
          id: uid
        }
      }
    }, {
      returnDocument: 'after',
    });

    if (!updated) continue;

    let ownerId = updated.ownerId;

    if (!updated.users || updated.users.length === 0) {
      await roomsCol.deleteOne({_id: updated._id});
      console.log(`🗑️  Sala ${updated._id} eliminada (vacía)`);
      continue;
    }

    if (room.ownerId === uid) {
      const newOwner = updated.users[0];
      const ownerUpdated = await roomsCol.updateOne(
        {_id: updated._id},
        {$set: {ownerId: newOwner.id}},
      );

      if (ownerUpdated.modifiedCount === 1) {
        ownerId = newOwner.id;
        console.log(`👑  Nuevo propietario en sala ${updated._id}: ${newOwner.name}`);
      }
    }

    await broadcast<RoomUpdatedMessage>({
      room: updated,
      message: {
        type: 'room:updated',
        room: roomDocumentToRoom({
          ...updated,
          ownerId,
        }),
      }
    });
  }
}

function roomToRoomDocument(room: Room): RoomDocument {
  const { id, ...rest } = room;

  return {
    _id: id as unknown as ObjectId,
    ...rest,
  };
}

function roomDocumentToRoom(roomDoc: RoomDocument): Room {
  const { _id, ...rest } = roomDoc;

  return {
    id: roomDoc._id.toString(),
    ...rest,
  };
}

async function start(): Promise<void> {
  await connectToDb();
  const roomsCol = getRoomsCollection();
  await roomsCol.deleteMany();

  await roomsCol.createIndex({'users.id': 1});

  const server = app.listen(PORT, () => {
    console.log(`🚀  Servidor HTTP escuchando en http://localhost:${PORT}`);
  });

  const wss = new WebSocketServer({server});
  console.log('🔌  Servidor WebSocket listo');

  wss.on('connection', (ws: ExtendedWebSocket) => {
    console.log('✅  Nueva conexión WebSocket');
    let currentUserId: string | null = null;
    let currentRoomId: string | null = null;

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as IncomingMessage;
        console.log('📨  Mensaje recibido:', message.type);

        switch (message.type) {
          case 'room:create': {
            const { roomName, ownerName, cards } = message as RoomCreateMessage;

            const owner: User = {
              id: generateId(),
              name: ownerName,
              isReady: false,
              vote: null,
              spectator: false,
            }

            const room: Room = {
              id: generateId(),
              name: roomName,
              ownerId: owner.id,
              users: [owner],
              revealed: false,
              cards,
              createdAt: Date.now(),
            }

            await roomsCol.insertOne(roomToRoomDocument(room));

            userSockets.set(owner.id, ws);
            currentUserId = owner.id;
            currentRoomId = room.id;

            broadcastToUser<RoomCreatedMessage>(owner.id, {
              type: 'room:created',
              room,
              ownerId: owner.id,
            });

            console.log('🏠  Sala creada:');
            console.log('🆔  ID:', room.id);
            console.log('📛  Nombre:', room.name);
            console.log('👤  Propietario:', owner.name);
            console.log('🗃️  Cartas:', cards.join(', '));
            break;
          }

          case 'room:join': {
            const { roomId, userName } = message as RoomJoinMessage;

            const room = await roomsCol.findOne({ _id: roomId });
            if (!room) {
              ws.send(JSON.stringify({
                type: 'room:error',
                message: 'Sala no encontrada'
              }));
              break;
            }

            const user: User = {
              id: generateId(),
              name: userName,
              isReady: false,
              vote: null,
              spectator: false,
            }

            const updatedRoom = await roomsCol.findOneAndUpdate(
              { _id: roomId },
              {
                $push: {
                  users: user
                }
              },
              {
                returnDocument: 'after',
              });

            if (!updatedRoom) {
              ws.send(JSON.stringify({
                type: 'room:error',
                message: 'Error al unirse a la sala'
              }));
              break;
            }

            userSockets.set(user.id, ws);
            currentUserId = user.id;
            currentRoomId = updatedRoom._id.toString();

            broadcastToUser<RoomJoinedMessage>(user.id, {
              type: 'room:joined',
              room: roomDocumentToRoom(updatedRoom),
              userId: user.id,
            });

            await broadcast<RoomUpdatedMessage>({
              room: updatedRoom,
              message: {
                type: 'room:updated',
                room: roomDocumentToRoom(updatedRoom),
              }
            })

            console.log(`👤  Usuario unido: ${user.name} a la sala ${roomId}`);

            break;
          }

          case 'room:reveal': {
            if (!currentRoomId || !currentUserId) {
              ws.send(JSON.stringify({
                type: 'room:error',
                message: 'No estás en una sala'
              }));
              break;
            }

            const room = await roomsCol.findOne({_id: currentRoomId as unknown as ObjectId});
            if (!room) {
              ws.send(JSON.stringify({
                type: 'room:error',
                message: 'Sala no encontrada'
              }));
              break;
            }

            if (room.ownerId !== currentUserId) {
              ws.send(JSON.stringify({
                type: 'room:error',
                message: 'Solo el propietario puede revelar los votos'
              }));
              break;
            }

            await roomsCol.updateOne(
              {_id: currentRoomId as unknown as ObjectId},
              {$set: {revealed: true}},
            );

            await broadcast<RoomUpdatedMessage>({
              room,
              message: {
                type: 'room:updated',
                room: roomDocumentToRoom({
                  ...room,
                  revealed: true,
                }),
              }
            });

            console.log(`👁️  Votos revelados en sala ${currentRoomId}`);
            break;
          }

          case 'user:vote': {
            const { vote } = message as UserVoteMessage;
            if (!currentRoomId || !currentUserId) {
              ws.send(JSON.stringify({
                type: 'room:error',
                message: 'No estás en una sala'
              }));
              break;
            }

            const updatedRoom = await roomsCol.findOneAndUpdate(
              {
                _id: currentRoomId as unknown as ObjectId,
                'users.id': currentUserId
              },
              { $set: { 'users.$.vote': vote, 'users.$.isReady': true } },
              { returnDocument: 'after' }
            );

            if (!updatedRoom) {
              ws.send(JSON.stringify({
                type: 'room:error',
                message: 'Error al registrar el voto'
              }));
              break;
            }

            await broadcast<RoomUpdatedMessage>({
              room: updatedRoom,
              message: {
                type: 'room:updated',
                room: roomDocumentToRoom(updatedRoom),
              }
            })

            console.log(`🗳️  Usuario ${currentUserId} votó ${vote} en sala ${currentRoomId}`);
            break;
          }

          case 'user:spectate': {
            const { spectator } = message;
            if (!currentRoomId || !currentUserId) {
              ws.send(JSON.stringify({
                type: 'room:error',
                message: 'No estás en una sala'
              }));
              break;
            }

            const updatedRoom = await roomsCol.findOneAndUpdate(
              {
                _id: currentRoomId as unknown as ObjectId,
                'users.id': currentUserId
              },
              { $set: {
                'users.$.spectator': spectator,
                'users.$.isReady': spectator ? false : undefined,
                'users.$.vote': spectator ? null : undefined,
              } },
              { returnDocument: 'after' }
            );

            if (!updatedRoom) {
              ws.send(JSON.stringify({
                type: 'room:error',
                message: 'Error al actualizar el estado de espectador'
              }));
              break;
            }

            await broadcast<RoomUpdatedMessage>({
              room: updatedRoom,
              message: {
                type: 'room:updated',
                room: roomDocumentToRoom(updatedRoom),
              }
            })

            console.log(`👀  Usuario ${currentUserId} cambió estado de espectador a ${spectator} en sala ${currentRoomId}`);
            break;
          }

          case 'room:reset': {
            if (!currentRoomId || !currentUserId) {
              ws.send(JSON.stringify({
                type: 'room:error',
                message: 'No estás en una sala'
              }));
              break;
            }

            const room = await roomsCol.findOne({
              _id: currentRoomId as unknown as ObjectId
            }, {
              projection: {
                ownerId: true
              }
            });

            console.log('room', room);
            if (!room) {
              ws.send(JSON.stringify({
                type: 'room:error',
                message: 'Sala no encontrada'
              }));
              break;
            }

            if (room.ownerId !== currentUserId) {
              ws.send(JSON.stringify({
                type: 'room:error',
                message: 'Solo el propietario puede reiniciar la votación'
              }));
              break;
            }

            const updated = await roomsCol.findOneAndUpdate(
              { _id: currentRoomId as unknown as ObjectId },
              { $set: { 'users.$[].vote': null, 'users.$[].isReady': false, revealed: false }},
              { returnDocument: 'after' }
            );

            if (!updated) {
              ws.send(JSON.stringify({
                type: 'room:error',
                message: 'Error al reiniciar la votación'
              }));
              break;
            }

            await broadcast<RoomUpdatedMessage>({
              room: updated,
              message: {
                type: 'room:updated',
                room: roomDocumentToRoom(updated),
              }
            });

            console.log(`🔄  Votación reiniciada en sala ${currentRoomId}`);

            break;
          }

          default:
            console.warn('⚠️  Tipo de mensaje desconocido:', (message as { type: string }).type);
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Tipo de mensaje desconocido',
            }));
            break;
        }
      } catch (error) {
        console.error('❌  Error procesando mensaje:', error);

        ws.send(JSON.stringify({
          type: 'error',
          message: 'Error procesando el mensaje',
        }));
      }
    });

    ws.on('close', () => {
      console.log('❌  Conexión WebSocket cerrada');
      if (currentUserId) {
        cleanupUser({ uid: currentUserId }).catch((err) => console.error('cleanupUser error', err));
      }
    });

    ws.on('error', (error: Error) => {
      console.error('❌  Error WebSocket:', error);
    });
  });

  app.get('/health', async (req: Request, res: Response) => {
    try {
      const rooms = await roomsCol.countDocuments();

      res.json({
        status: 'ok',
        rooms,
        connections: userSockets.size,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      res.status(500).json({status: 'error', message: 'No se pudo obtener health'});
    }
  });

  process.on('uncaughtException', (error: Error) => {
    console.error('❌  Error no capturado:', error);
  });
  process.on('unhandledRejection', (reason: string) => {
    console.error('❌  Promise rechazada no manejada:', reason);
  });

  console.log('✨  Servidor de Planning Poker iniciado con MongoDB');
}

start().catch((err) => {
  console.error('No se pudo iniciar el servidor:', err);
  process.exit(1);
});
