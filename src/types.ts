import { WebSocket } from 'ws';
import {ObjectId, WithId} from "mongodb";

// Base types
export type User = {
  id: string;
  name: string;
  isReady: boolean;
  vote: string | null;
  spectator: boolean;
}

type RoomBase = {
  name: string;
  ownerId: string;
  users: User[];
  revealed: boolean;
  cards: string[];
  createdAt: number;
}

export type Room = RoomBase & {
  id: string;
}

export type RoomDocument = WithId<RoomBase>;

export type WebSocketMessage = {
  type: string;
  [key: string]: any;
}

// Room Messages
export type RoomCreateMessage = WebSocketMessage & {
  type: 'room:create';
  roomName: string;
  ownerName: string;
  cards: string[];
}

export type RoomJoinMessage = WebSocketMessage & {
  type: 'room:join';
  roomId: ObjectId;
  userName: string;
}

export type RoomRevealMessage = WebSocketMessage & {
  type: 'room:reveal';
}

export type RoomResetMessage = WebSocketMessage & {
  type: 'room:reset';
}

// User Messages
export type UserVoteMessage = WebSocketMessage & {
  type: 'user:vote';
  vote: string;
}

export type UserSpectateMessage = WebSocketMessage & {
  type: 'user:spectate';
  spectator: boolean;
}

export type IncomingMessage =
  | RoomCreateMessage
  | RoomJoinMessage
  | RoomRevealMessage
  | RoomResetMessage
  | UserVoteMessage
  | UserSpectateMessage;

// Outgoing Messages
export type RoomCreatedMessage = WebSocketMessage & {
  type: 'room:created';
  room: Room;
  ownerId: string;
}

export type RoomJoinedMessage = WebSocketMessage & {
  type: 'room:joined';
  room: Room;
  userId: string;
}

export type RoomUpdatedMessage = WebSocketMessage & {
  type: 'room:updated';
  room: Room;
}

export type ExtendedWebSocket  = WebSocket & {
  currentUserId?: string;
  currentRoomId?: string;
}

export type BroadcastMessage<MessageType extends WebSocketMessage> = {
  room: RoomDocument;
  message: MessageType;
  excludeUserId?: string;
}
