// Durable Object Class for managing chat room state and WebSockets
export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = []; // Stores active WebSocket connections
    this.userLocations = new Map(); // Stores user ID -> { lat, lon }
    this.userNames = new Map(); // Stores user ID -> name
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

    } else if (url.pathname === '/') {
      return new Response('Welcome to the Map Chat Worker!', { status: 200, headers: { 'Content-Type': 'text/html' } });
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
        users: Array.from(this.userLocations.entries()).map(([id, loc]) => ({
          id,
          ...loc,
          name: this.userNames.get(id) || null
        }))
      };
    ws.send(JSON.stringify(initialData));

    ws.addEventListener('message', async (msg) => {
      try {
        const data = JSON.parse(msg.data);

        switch (data.type) {
          case 'login':
            if (typeof data.name === 'string') {
              this.userNames.set(userId, data.name);
            }
            break;

          // --- Location Update ---
          // Removed the duplicate case block that was here.
          case 'updateLocation':
            this.userLocations.set(userId, { lat: data.lat, lon: data.lon });
            // Also update/store username if sent with location (optional)
            if (typeof data.name === 'string') {
               this.userNames.set(userId, data.name);
            }
            this.broadcast({
              type: 'userMoved',
              userId: userId,
              lat: data.lat,
              lon: data.lon,
              name: this.userNames.get(userId) || null // Send name with location update
            }, ws); // Exclude sender
            break;

          // --- Global Chat (Keep or Remove?) ---
          // Decide if you still want a global chat alongside private. Removing for now.
          // case 'chatMessage':
          //   this.broadcast({
          //     type: 'chatMessage',
          //     senderId: userId,
          //     senderName: this.userNames.get(userId) || null, // Include sender name
          //     message: data.message,
          //   });
          //   break;

          // --- Private Chat Logic ---
          case 'chatRequest': // User requests to chat with another user
            console.log(`Chat request from ${userId} to ${data.recipientId}`);
            this.sendToUser(data.recipientId, {
              type: 'chatRequest',
              senderId: userId,
              senderName: this.userNames.get(userId) || `User ${userId.substring(0,4)}` // Send sender's name
            });
            break;

          case 'chatAccept': // User accepts a chat request
             console.log(`Chat accept from ${userId} to ${data.recipientId}`);
             this.sendToUser(data.recipientId, { // Notify the original requester
               type: 'chatAccept',
               senderId: userId, // The user who accepted
               senderName: this.userNames.get(userId) || `User ${userId.substring(0,4)}` // Send acceptor's name
             });
             break;

          case 'privateMessage': // Send a private message
            console.log(`Private message from ${userId} to ${data.recipientId}`);
            this.sendToUser(data.recipientId, {
              type: 'privateMessage',
              senderId: userId,
              senderName: this.userNames.get(userId) || `User ${userId.substring(0,4)}`, // Include sender name
              message: data.message
            });
            break;

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
        name: this.userNames.get(userId) || null
      });
      this.userNames.delete(userId);
    }
  }

  // Sends a message to a specific user by ID
  sendToUser(recipientId, message) {
    const session = this.sessions.find(s => s.userId === recipientId);
    if (session) {
      try {
        session.ws.send(JSON.stringify(message));
      } catch (err) {
        console.error(`Failed to send to user ${recipientId}:`, err);
      }
    }
  }
}

// --- Password Hashing Helpers ---

// Generates a salt and hashes the password using PBKDF2
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 100000; // Adjust as needed
  const keylen = 64; // 512 bits
  const digest = 'SHA-512';

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt, iterations: iterations, hash: digest },
    key,
    keylen * 8 // length in bits
  );

  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const saltArray = Array.from(salt);

  // Store salt and hash together, e.g., salt:hash
  return `${saltArray.map(b => b.toString(16).padStart(2, '0')).join('')}:${hashArray.map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

// Verifies a password against a stored salt:hash string
async function verifyPassword(storedPasswordHash, providedPassword) {
  try {
    const [saltHex, hashHex] = storedPasswordHash.split(':');
    if (!saltHex || !hashHex) return false;

    const salt = new Uint8Array(saltHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const storedHash = new Uint8Array(hashHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

    const iterations = 100000; // Must match the iterations used for hashing
    const keylen = 64;
    const digest = 'SHA-512';

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(providedPassword),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    const derivedKeyBuffer = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: salt, iterations: iterations, hash: digest },
      key,
      keylen * 8
    );

    const derivedKey = new Uint8Array(derivedKeyBuffer);

    // Compare derived key with stored hash (timing-safe comparison is ideal but complex here)
    if (derivedKey.length !== storedHash.length) return false;
    for (let i = 0; i < derivedKey.length; i++) {
      if (derivedKey[i] !== storedHash[i]) return false;
    }
    return true;
  } catch (error) {
    console.error("Error verifying password:", error);
    return false;
  }
}


// --- API Handlers ---

async function handleRegister(request, env) {
  try {
    const { email, username, password, age, gender } = await request.json();

    // Basic validation
    if (!email || !username || !password) {
      return new Response(JSON.stringify({ error: 'Email, username, and password are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (password.length < 8) {
       return new Response(JSON.stringify({ error: 'Password must be at least 8 characters long' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const userId = crypto.randomUUID();
    const hashedPassword = await hashPassword(password);

    await env.DB.prepare(
      'INSERT INTO users (id, email, username, password_hash, age, gender) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(userId, email, username, hashedPassword, age || null, gender || null)
      .run();

    // Don't return password hash
    return new Response(JSON.stringify({ success: true, userId, email, username }), { status: 201, headers: { 'Content-Type': 'application/json' } });

  } catch (e) {
    console.error('Registration error:', e);
    // Check for unique constraint violation (specific error codes depend on D1/SQLite)
    if (e.message && (e.message.includes('UNIQUE constraint failed: users.email') || e.message.includes('UNIQUE constraint failed: users.username'))) {
       return new Response(JSON.stringify({ error: 'Email or username already exists' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'Registration failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

async function handleLogin(request, env) {
  try {
    const { email, password } = await request.json(); // Assuming login via email

    if (!email || !password) {
      return new Response(JSON.stringify({ error: 'Email and password are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const user = await env.DB.prepare('SELECT id, email, username, password_hash, age, gender FROM users WHERE email = ?')
      .bind(email)
      .first();

    if (!user) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const passwordMatch = await verifyPassword(user.password_hash, password);

    if (!passwordMatch) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    // Login successful - return user info (excluding hash)
    // In a real app, you'd generate a session token/JWT here
    const { password_hash, ...userInfo } = user;
    return new Response(JSON.stringify({ success: true, user: userInfo }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (e) {
    console.error('Login error:', e);
    return new Response(JSON.stringify({ error: 'Login failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}


// --- Main Worker Fetch Handler ---
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try { // Add a top-level try block for API routes
      // Route API requests
      if (url.pathname === '/api/register' && request.method === 'POST') {
        return await handleRegister(request, env); // Ensure await if handler is async
      }
      if (url.pathname === '/api/login' && request.method === 'POST') {
        return await handleLogin(request, env); // Ensure await if handler is async
      }
    } catch (err) {
      // Catch any unhandled errors from API handlers and return JSON
      console.error(`Unhandled API Error (${url.pathname}):`, err);
      return new Response(JSON.stringify({ error: 'An internal server error occurred.', details: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Route WebSocket upgrade requests to the Durable Object (outside the API try-catch)
    if (url.pathname === '/websocket') {
       // Use a single global instance of the ChatRoom Durable Object
       // All users will connect to the same room instance.
       // For scalability, you might shard users into different rooms based on location, etc.
       const durableObjectId = env.CHAT_ROOM.idFromName('global-chat-room');
       const durableObjectStub = env.CHAT_ROOM.get(durableObjectId);
       return durableObjectStub.fetch(request); // Forward the request
    }

    // Handle other requests (e.g., root path or not found)
    if (url.pathname === '/') {
       return new Response('MapChat API Worker is running.', { status: 200 });
    }

    return new Response('Not Found', { status: 404 });
  },
};
