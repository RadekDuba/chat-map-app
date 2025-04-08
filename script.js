maptilersdk.config.apiKey = 'Ac1UVUxWl0WYiAANdAIc';

const map = new maptilersdk.Map({
  container: 'map',
  style: maptilersdk.MapStyle.STREETS,
  geolocate: maptilersdk.GeolocationType.POINT,
});

function login() {
  const usernameInput = document.getElementById("usernameInput");
  myUsername = usernameInput.value.trim();
  if (!myUsername) {
    alert("Please enter your name.");
    return;
  }
  document.getElementById("login").style.display = "none";
  document.getElementById("map").style.display = "block";
  connectWebSocket();
  startLocationWatch(); // Request location after login
}

let myUserId = null;
const userMarkers = new Map(); // Stores userId -> { marker, popup }
let myMarker = null;

function connectWebSocket() {
  // Use the deployed worker URL
  const wsUrl = `wss://chat-worker.radek-duba.workers.dev/websocket`;
  console.log(`Connecting to WebSocket: ${wsUrl}`);
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log("WebSocket connected!");
    addSystemMessage("Connected to chat server.");
    // Start watching location once connected
    startLocationWatch();
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log("Received:", data);

      switch (data.type) {
        case 'init':
          myUserId = data.userId;
          addSystemMessage(`You are User ${myUserId.substring(0, 6)}...`);
          // Add markers for existing users
          data.users.forEach(user => {
            if (user.id !== myUserId) {
              updateUserMarker(user.id, user.lat, user.lon);
            }
          });
          break;
        case 'userMoved':
          if (data.userId !== myUserId) {
            updateUserMarker(data.userId, data.lat, data.lon);
          }
          break;
        case 'userLeft':
          if (data.userId !== myUserId) {
            removeUserMarker(data.userId);
            addSystemMessage(`User ${data.userId.substring(0, 6)}... left.`);
          }
          break;
        case 'chatMessage':
          const senderName = data.senderId === myUserId ? "You" : `User ${data.senderId.substring(0, 6)}...`;
          addChatMessage(senderName, data.message);
          // Optional: Highlight marker of sender?
          break;
        case 'error':
          addSystemMessage(`Server Error: ${data.message}`, true);
          break;
        default:
          console.log("Unknown message type:", data.type);
      }
    } catch (err) {
      console.error("Failed to parse message:", event.data, err);
      addSystemMessage("Received unreadable message from server.", true);
    }
  };

  socket.onerror = (error) => {
    console.error("WebSocket Error:", error);
    addSystemMessage("WebSocket connection error.", true);
  };

  socket.onclose = (event) => {
    console.log("WebSocket closed:", event.code, event.reason);
    addSystemMessage(`Disconnected: ${event.reason || 'Connection closed'}. Attempting to reconnect...`, event.code !== 1000);
    myUserId = null;
    // Clear existing markers
    userMarkers.forEach(removeUserMarker);
    userMarkers.clear();
    if (myMarker) {
        myMarker.remove();
        myMarker = null;
    }
    // Attempt to reconnect after a delay
    setTimeout(connectWebSocket, 5000);
  };
}

function sendMessage() {
  if (!socket || socket.readyState !== WebSocket.OPEN || !myUserId) {
    addSystemMessage("Not connected, cannot send message.", true);
    return;
  }
  const input = document.getElementById("messageInput");
  const message = input.value.trim();
  if (!message) return;

  socket.send(JSON.stringify({
    type: 'chatMessage',
    message: message
  }));
  // Don't add locally, wait for broadcast confirmation
  // addChatMessage("You", message);
  input.value = "";
}

function addChatMessage(sender, message) {
  const msgBox = document.getElementById("messages");
  const msg = document.createElement("div");
  msg.innerHTML = `<strong>${sender}:</strong> ${message}`;
  msgBox.appendChild(msg);
  msgBox.scrollTop = msgBox.scrollHeight; // Scroll to bottom
}

 function addSystemMessage(message, isError = false) {
  const msgBox = document.getElementById("messages");
  const msg = document.createElement("div");
  msg.textContent = message;
  msg.style.fontStyle = 'italic';
  if (isError) {
    msg.style.color = 'red';
  }
  msgBox.appendChild(msg);
  msgBox.scrollTop = msgBox.scrollHeight;
}

function updateUserMarker(userId, lat, lon) {
  const shortId = userId.substring(0, 6);
  if (userMarkers.has(userId)) {
    // Update existing marker
    const { marker } = userMarkers.get(userId);
    marker.setLngLat([lon, lat]);
  } else {
    // Create new marker
    console.log(`Adding marker for ${shortId} at ${lat}, ${lon}`);
    const popup = new maptilersdk.Popup({ closeButton: false, closeOnClick: false })
      .setText(userId === myUserId ? "You" : `${name} (${shortId})`);

    const marker = new maptilersdk.Marker({ color: getRandomColor() })
      .setLngLat([lon, lat])
      .setPopup(popup)
      .addTo(map);

    // Add click listener for chat (basic implementation)
    marker.getElement().addEventListener('click', () => {
      openChatWindow(userId, name);
    });

    userMarkers.set(userId, { marker, popup });
    addSystemMessage(`User ${shortId}... joined.`);
  }
}

function removeUserMarker(userId) {
  if (userMarkers.has(userId)) {
    console.log(`Removing marker for ${userId.substring(0, 6)}...`);
    const { marker } = userMarkers.get(userId);
    marker.remove();
    userMarkers.delete(userId);
  }
}

function updateMyMarker(lat, lon) {
    if (!myMarker) {
        myMarker = new maptilersdk.Marker({ color: "blue" })
            .setLngLat([lon, lat])
            .setPopup(new maptilersdk.Popup().setText("You"))
            .addTo(map);
    } else {
        myMarker.setLngLat([lon, lat]);
    }
}

// Geolocation Handling
function startLocationWatch() {
    if (!navigator.geolocation) {
        addSystemMessage("Geolocation is not supported by your browser.", true);
        return;
    }

    addSystemMessage("Attempting to get location...");

    const options = {
        enableHighAccuracy: true,
        timeout: 30000, // 30 seconds
        maximumAge: 0 // Don't use cached position
    };

    // Get initial position
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const { latitude, longitude } = pos.coords;
            console.log(`Initial location: ${latitude}, ${longitude}`);
            addSystemMessage(`Location found: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
            map.setCenter([longitude, latitude]);
            map.setZoom(15);
            updateMyMarker(latitude, longitude);

            // Send initial location to server
            if (socket && socket.readyState === WebSocket.OPEN && myUserId) {
                socket.send(JSON.stringify({ type: 'updateLocation', lat: latitude, lon: longitude }));
            }

            // Start watching for changes
            navigator.geolocation.watchPosition(handleLocationUpdate, handleLocationError, options);
        },
        handleLocationError, // Use the same error handler
        options
    );
}

function handleLocationUpdate(pos) {
    const { latitude, longitude } = pos.coords;
    console.log(`Location update: ${latitude}, ${longitude}`);
    updateMyMarker(latitude, longitude);

    // Send location update to server (throttle this in a real app)
    if (socket && socket.readyState === WebSocket.OPEN && myUserId) {
        socket.send(JSON.stringify({ type: 'updateLocation', lat: latitude, lon: longitude }));
    }
}

function handleLocationError(err) {
    console.error(`Geolocation Error (${err.code}): ${err.message}`);
    addSystemMessage(`Geolocation Error: ${err.message}`, true);
    // Could fall back to IP-based location or ask user to enable permissions
}

// Helper function for random marker colors
function getRandomColor() {
  const letters = '0123456789ABCDEF';
  let color = '#';
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  // Avoid colors too close to blue (self) or white/black
  if (color === '#0000FF' || color === '#FFFFFF' || color === '#000000') {
      return getRandomColor(); // Recurse
  }
  return color;
}

// Placeholder for opening a chat window
function openChatWindow(userId) {
    // TODO: Implement the actual chat window UI
    addSystemMessage(`Clicked on User ${userId.substring(0, 6)}... Chat UI not implemented yet.`);
    // Maybe focus the input and add a prefix like "@User123: "?
    const input = document.getElementById("messageInput");
    input.value = `@${userId.substring(0, 6)}: `;
    input.focus();
}

// Initial connection
connectWebSocket();
