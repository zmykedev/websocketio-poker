import { MongoClient } from 'mongodb';

let client;
let db;

export async function connectToDb() {
  if (db) return db;
  const uri = process.env.DB_URI;
  if (!uri) {
    throw new Error('DB_URL no está definido en el entorno (.env)');
  }

  const dbName = process.env.DB_NAME;

  client = new MongoClient(uri, {
    // useUnifiedTopology: true, // no necesario en drivers modernos
    // retryWrites por defecto en true si el cluster lo permite
  });
  await client.connect();
  db = client.db(dbName);
  console.log(`Conectado a la base de datos: ${dbName}`);
  return db;
}

export function getDb() {
  if (!db) throw new Error('DB no inicializada. Llama primero a connectToDb()');
  return db;
}

export function getRoomsCollection() {
  return getDb().collection('rooms');
}

export async function closeDb() {
  if (client) {
    await client.close();
    client = undefined;
    db = undefined;
  }
}

