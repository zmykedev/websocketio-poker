# Planning Poker Server

Backend con WebSocket real para la aplicación de Planning Poker, ahora con persistencia en MongoDB.

## 🚀 Instalación

Usa tu gestor preferido (pnpm recomendado porque hay pnpm-lock.yaml):

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

### Modo Producción
```bash
pnpm start
# o
npm start
```

El servidor estará disponible en:
- HTTP: http://localhost:3001
- WebSocket: ws://localhost:3001

## 🔌 API WebSocket

La API de WebSocket no cambió; los mensajes son los mismos. Ejemplos:

### Crear Sala
```json
{
  "type": "room:create",
  "roomName": "Sprint 24",
  "userName": "Juan Pérez",
  "cardDeck": {
    "id": "fibonacci",
    "name": "Fibonacci",
    "values": [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, "?"]
  }
}
```

### Unirse a Sala
```json
{
  "type": "room:join",
  "roomId": "abc123",
  "userName": "María García"
}
```

### Votar
```json
{
  "type": "user:vote",
  "vote": 5
}
```

### Revelar Votos (solo moderador)
```json
{ "type": "room:reveal" }
```

### Reiniciar Votación (solo moderador)
```json
{ "type": "room:reset" }
```

### Mensajes del Servidor
- room:created, room:joined, room:updated, room:revealed, room:reset, room:error

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

## 🔧 Variables de Entorno

Crea un archivo `.env` en la raíz del proyecto con al menos:

```
PORT=3001
DB_URL=mongodb://usuario:password@host:27017
# opcional, por defecto: planning_poker
DB_NAME=planning_poker
```

También puedes usar las variables `MONGODB_URI` o `MONGO_URL` si prefieres esos nombres.

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
