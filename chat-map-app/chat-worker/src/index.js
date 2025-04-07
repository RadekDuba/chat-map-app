// Durable Object Class for managing chat room state and WebSockets
export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = []; // Stores active WebSocket connections
    this.userLocations = new Map(); // Stores user ID -> { lat, lon }
  }

  // Handles incoming HTTP requests (specifically WebSocket upgrades)
  async fetch(request) {
    const url = new URL(request.url);

    // Expecting requests like /websocket
    if (url.pathname === '/websocket') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected Upgrade: websocket', { status: 426 });
      }

      // Generate a unique ID for the user (can be improved later)
      const userId = crypto.randomUUID();

      // Create the WebSocket pair for the client
      const [client, server] = new WebSocketPair();

      // Store the server-side socket and user ID
      this.sessions.push({ ws: server, userId: userId });

      // Handle WebSocket events on the server side
      await this.handleSession(server, userId);

      // Return the client-side socket to the connecting user
      return new Response(null, {
        status: 101,
        webSocket: client,
      });

    } else {
      return new Response('Not found', { status: 404 });
    }
  }

  // Handles an individual WebSocket connection
  async handleSession(ws, userId) {
    ws.accept();

    // Send the new user their ID and current locations of others
    const initialData = {
      type: 'init',
      userId: userId,
      users: Array.from(this.userLocations.entries()).map(([id, loc]) => ({ id, ...loc }))
    };
    ws.send(JSON.stringify(initialData));

    ws.addEventListener('message', async (msg) => {
      try {
        const data = JSON.parse(msg.data);

        switch (data.type) {
          case 'updateLocation':
            // Store user's location
            this.userLocations.set(userId, { lat: data.lat, lon: data.lon });
            // Broadcast new location to others
            this.broadcast({
              type: 'userMoved',
              userId: userId,
              lat: data.lat,
              lon: data.lon,
            }, ws); // Exclude sender
            break;

          case 'chatMessage':
            // Broadcast chat message to everyone (including sender for confirmation)
            this.broadcast({
              type: 'chatMessage',
              senderId: userId,
              message: data.message,
            });
            break;

          // Add cases for private messages later
          // case 'privateMessage':
          //   this.sendToUser(data.recipientId, { ... });
          //   break;

          default:
            console.log('Unknown message type:', data.type);
        }
      } catch (err) {
        console.error('Failed to parse message or handle:', err);
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });

    ws.addEventListener('close', async (evt) => {
      this.handleDisconnect(ws, userId);
    });

    ws.addEventListener('error', async (evt) => {
      console.error('WebSocket error:', evt.message);
      this.handleDisconnect(ws, userId);
    });
  }

  // Broadcasts a message to all connected clients, optionally excluding one
  broadcast(message, excludeWs = null) {
    const messageString = JSON.stringify(message);
    this.sessions = this.sessions.filter((session) => {
      if (session.ws === excludeWs) return true; // Keep the excluded session in the list

      try {
        session.ws.send(messageString);
        return true; // Keep session if send is successful
      } catch (err) {
        console.error(`Failed to send to client ${session.userId}:`, err);
        // Assume connection is dead, remove from sessions
        this.handleDisconnect(session.ws, session.userId, false); // Don't broadcast disconnect again if already doing so
        return false;
      }
    });
  }

  // Handles user disconnection
  handleDisconnect(ws, userId, shouldBroadcast = true) {
    console.log(`User ${userId} disconnected.`);
    // Remove the session
    this.sessions = this.sessions.filter((session) => session.ws !== ws);
    // Remove user location
    this.userLocations.delete(userId);

    // Notify others about the disconnection
    if (shouldBroadcast) {
      this.broadcast({
        type: 'userLeft',
        userId: userId,
      });
    }
  }

  // TODO: Implement sending to a specific user for private chat
  // sendToUser(recipientId, message) { ... }
}

// Main Worker fetch handler - routes requests to the Durable Object
export default {
  async fetch(request, env) {
    // Use a single global instance of the ChatRoom Durable Object
    // All users will connect to the same room instance.
    // For scalability, you might shard users into different rooms based on location, etc.
    const durableObjectId = env.CHAT_ROOM.idFromName('global-chat-room');
    const durableObjectStub = env.CHAT_ROOM.get(durableObjectId);

    // Forward the request to the Durable Object's fetch handler
    return durableObjectStub.fetch(request);
  },
};
