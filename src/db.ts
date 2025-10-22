import { MongoClient, Db, Collection } from 'mongodb';
import { RoomDocument } from './types.js';

let client: MongoClient | undefined;
let db: Db | undefined;

export async function connectToDb(): Promise<Db> {
  if (db) return db;

  const uri = process.env.MONGO_URL;
  if (!uri) {
    throw new Error('MONGO_URL no está definido en el entorno (.env)');
  }

  const dbName = process.env.DB_NAME;
  if (!dbName) {
    throw new Error('DB_NAME no está definido en el entorno (.env)');
  }

  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);
  console.log(`Conectado a la base de datos: ${dbName}`);
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error('DB no inicializada. Llama primero a connectToDb()');
  return db;
}

export function getRoomsCollection(): Collection<RoomDocument> {
  return getDb().collection<RoomDocument>('rooms');
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
    client = undefined;
    db = undefined;
  }
}

