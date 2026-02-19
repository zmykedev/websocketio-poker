import { MongoClient, Db, Collection } from 'mongodb';
import { RoomDocument } from './types.js';

let client: MongoClient | undefined;
let db: Db | undefined;

export async function connectToDb(): Promise<Db> {
  if (db) return db;

  const uri = (process.env.MONGO_URL || '').trim();
  if (!uri) {
    throw new Error(
      'MONGO_URL no está definido. En local usa .env; en producción configúralo en tu plataforma (Railway → Variables, Render → Environment, etc.).'
    );
  }
  const validScheme = /^mongodb(\+srv)?:\/\//i.test(uri);
  if (!validScheme) {
    throw new Error(
      'MONGO_URL debe empezar por mongodb:// o mongodb+srv://. Revisa que no hayas puesto otra variable (ej. URL del servicio, Redis, PostgreSQL). Usa el connection string de MongoDB Atlas o tu servidor MongoDB.'
    );
  }

  const dbName = process.env.DB_NAME;
  if (!dbName) {
    throw new Error(
      'DB_NAME no está definido. En local usa .env; en producción configúralo en tu plataforma (Railway → Variables, etc.).'
    );
  }

  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);
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

