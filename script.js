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
let myUsername = null; // Added to store the logged-in user's name
const userMarkers = new Map(); // Stores userId -> { marker, popup, name }
let myMarker = null;
let currentChatTarget = { userId: null, name: null }; // To track the current chat partner

function connectWebSocket() {
  // Use the deployed worker URL
  const wsUrl = `wss://chat-worker.radek-duba.workers.dev/websocket`;
  console.log(`Connecting to WebSocket: ${wsUrl}`);
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log("WebSocket connected!");
    addSystemMessage("Connected to chat server.");
    // Send login info
    if (myUsername && myUserId) { // myUserId should be set in 'init' before this runs ideally, but check just in case
        socket.send(JSON.stringify({ type: 'login', name: myUsername, userId: myUserId }));
    }
    // Location watch is started from login() now
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log("Received:", data);

      switch (data.type) {
        case 'init':
          myUserId = data.userId; // Server assigns the ID
          addSystemMessage(`You are ${myUsername} (${myUserId.substring(0, 6)}...)`);
          // Send login info with assigned userId
           socket.send(JSON.stringify({ type: 'login', name: myUsername, userId: myUserId }));
          // Add markers for existing users (assuming server sends name)
          data.users.forEach(user => {
            if (user.id !== myUserId) {
              updateUserMarker(user.id, user.lat, user.lon, user.name || `User ${user.id.substring(0,6)}`); // Use name if available
            }
          });
          break;
        case 'userMoved':
          // A new user joined or an existing user moved
          if (data.userId !== myUserId) {
             // Assuming server sends name on userMoved/userJoined
            updateUserMarker(data.userId, data.lat, data.lon, data.name || `User ${data.userId.substring(0,6)}`);
          }
          break;
        case 'userLeft':
          // User left
          if (data.userId !== myUserId) {
            const userData = userMarkers.get(data.userId);
            const leftName = userData ? userData.name : `User ${data.userId.substring(0, 6)}`;
            removeUserMarker(data.userId);
            addSystemMessage(`${leftName} left.`);
            // If chatting with the user who left, close the chat window
            if (currentChatTarget.userId === data.userId) {
                closeChatWindow();
            }
          }
          break;
        case 'privateMessage':
          // Only display if the message is part of the current chat
          if (currentChatTarget.userId && (data.senderId === currentChatTarget.userId || data.senderId === myUserId)) {
              const senderDisplayName = data.senderId === myUserId ? "You" : currentChatTarget.name; // Use the stored name
              addChatMessage(senderDisplayName, data.message);
          } else {
              // Optional: Indicate a new message from someone else? (e.g., highlight their marker)
              console.log(`Received private message from ${data.senderId}, but not currently chatting with them.`);
          }
          break;
        // Keep 'chatMessage' for potential global/system messages if needed, or remove if only private chat exists
        // case 'chatMessage':
        //   const senderName = data.senderId === myUserId ? "You" : `User ${data.senderId.substring(0, 6)}...`;
        //   addChatMessage(senderName, data.message);
        //   break;
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
  if (!socket || socket.readyState !== WebSocket.OPEN || !myUserId || !currentChatTarget.userId) {
    addSystemMessage("Cannot send message. Not connected or no chat active.", true);
    return;
  }
  const input = document.getElementById("messageInput");
  const message = input.value.trim();
  if (!message) return;

  const messageData = {
    type: 'privateMessage',
    recipientId: currentChatTarget.userId,
    message: message,
    senderName: myUsername // Send sender's name
  };

  socket.send(JSON.stringify(messageData));
  // Add message locally immediately for responsiveness
  addChatMessage("You", message);
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
  // Decide where to put system messages - maybe a separate log area?
  // For now, adding to the main chat window if open, otherwise console.
  const msgBox = document.getElementById("messages"); // Assumes chat window is open
  const msg = document.createElement("div");
  msg.textContent = `[System] ${message}`;
  msg.style.fontStyle = 'italic';
  if (isError) {
    msg.style.color = 'red';
  }
  msgBox.appendChild(msg);
  msgBox.scrollTop = msgBox.scrollHeight;
}

function updateUserMarker(userId, lat, lon, name) { // Added name parameter
  const shortId = userId.substring(0, 6);
  const displayName = name || `User ${shortId}`; // Fallback if name is missing

  if (userMarkers.has(userId)) {
    // Update existing marker
    const existingData = userMarkers.get(userId);
    existingData.marker.setLngLat([lon, lat]);
    // Update popup content if name changes (though unlikely with current setup)
    const popupContent = createPopupContent(userId, displayName);
    existingData.popup.setHTML(popupContent);
    existingData.name = displayName; // Update stored name
  } else {
    // Create new marker
    console.log(`Adding marker for ${displayName} at ${lat}, ${lon}`);

    const popupContent = createPopupContent(userId, displayName);
    const popup = new maptilersdk.Popup({ closeButton: false, closeOnClick: false })
        .setHTML(popupContent); // Use setHTML for button

    const marker = new maptilersdk.Marker({ color: getRandomColor() })
      .setLngLat([lon, lat])
      .setPopup(popup)
      .addTo(map);

    // Store marker, popup, and name
    userMarkers.set(userId, { marker, popup, name: displayName });
    addSystemMessage(`${displayName} joined.`);
  }
}

// Helper to create popup HTML with a chat button
function createPopupContent(userId, name) {
    const title = userId === myUserId ? "You" : name;
    let content = `<div><strong>${title}</strong></div>`;
    if (userId !== myUserId) {
        // Use onclick that passes parameters correctly
        content += `<button onclick="initiateChat('${userId}', '${name.replace(/'/g, "\\'")}')">Chat</button>`; // Escape single quotes in name
    }
    return content;
}

// Renamed function to avoid conflict with DOM event handlers
function initiateChat(userId, name) {
    openChatWindow(userId, name);
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
        const popupContent = createPopupContent(myUserId, "You"); // Use helper for consistency
        myMarker = new maptilersdk.Marker({ color: "blue" })
            .setLngLat([lon, lat])
            .setPopup(new maptilersdk.Popup({ closeButton: false, closeOnClick: false }).setHTML(popupContent))
            .addTo(map);
    } else {
        myMarker.setLngLat([lon, lat]);
        // Optionally update popup if needed, though "You" shouldn't change
        // const popupContent = createPopupContent(myUserId, "You");
        // myMarker.getPopup().setHTML(popupContent);
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

// Opens the dedicated chat window
function openChatWindow(userId, name) {
    if (userId === myUserId) return; // Don't open chat with self

    currentChatTarget = { userId, name };
    console.log(`Opening chat with ${name} (${userId})`);

    document.getElementById("chatWith").textContent = name;
    document.getElementById("messages").innerHTML = ''; // Clear previous messages
    document.getElementById("chatWindow").style.display = "block"; // Show the window

    // Optional: Add a close button functionality
    // if (!document.getElementById('closeChatButton')) {
    //     const closeButton = document.createElement('button');
    //     closeButton.id = 'closeChatButton';
    //     closeButton.textContent = 'Close';
    //     closeButton.onclick = closeChatWindow;
    //     closeButton.style.marginLeft = '10px';
    //     document.getElementById('chatHeader').appendChild(closeButton);
    // }

    const input = document.getElementById("messageInput");
    input.value = ""; // Clear input
    input.focus();
}

function closeChatWindow() {
    currentChatTarget = { userId: null, name: null };
    document.getElementById("chatWindow").style.display = "none";
    document.getElementById("messages").innerHTML = ''; // Clear messages on close
}

// Don't connect WebSocket immediately, wait for login
// connectWebSocket();
