import React, { useState, useEffect, useRef, useCallback } from 'react';
import Login from './components/Login';
import Register from './components/Register';
import MapComponent from './components/Map';
import PrivateChat from './components/PrivateChat'; // Import the new component
import './App.css';

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [showLogin, setShowLogin] = useState(true);
  const ws = useRef(null); // Single WebSocket connection
  const [isConnected, setIsConnected] = useState(false);
  const [userId, setUserId] = useState(null); // Own user ID from server
  const [connectedUsers, setConnectedUsers] = useState(new Map()); // Map<userId, {id, name, lat, lon}>
  const [chatRequests, setChatRequests] = useState([]); // Array of { senderId, senderName }
  const [activeChats, setActiveChats] = useState(new Map()); // Map<userId, { name: string, messages: [] }>

  // --- WebSocket Management ---
  const connectWebSocket = useCallback(() => {
    if (!currentUser || ws.current) return; // Only connect if logged in and not already connected/connecting

    // Construct WebSocket URL using the worker API URL environment variable
    const workerApiUrl = import.meta.env.VITE_WORKER_API_URL || '';
    if (!workerApiUrl) {
       console.error("Worker API URL is not configured. Cannot connect WebSocket.");
       return; // Don't attempt connection if base URL is missing
    }
    // Replace http/https with ws/wss for the WebSocket protocol
    const wsUrl = workerApiUrl.replace(/^http/, 'ws') + '/websocket';
    console.log('App connecting WebSocket to:', wsUrl); // Should now point to the worker domain
    ws.current = new WebSocket(wsUrl);

    ws.current.onopen = () => {
      console.log('App WebSocket Connected');
      setIsConnected(true);
      ws.current.send(JSON.stringify({ type: 'login', name: currentUser.username }));
      // Request initial position update from Map component if needed, or send directly if available
    };

    ws.current.onclose = () => {
      console.log('App WebSocket Disconnected');
      setIsConnected(false);
      setUserId(null);
      setConnectedUsers(new Map());
      setChatRequests([]);
      setActiveChats(new Map()); // Clear chats on disconnect
      ws.current = null; // Clear the ref
      // Optional: attempt to reconnect after a delay
    };

    ws.current.onerror = (error) => {
      console.error('App WebSocket Error:', error);
      // Consider closing and attempting reconnect
      ws.current?.close();
    };

    ws.current.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('App WebSocket Message Received:', message);

        switch (message.type) {
          case 'init':
            setUserId(message.userId);
            const initialUsers = new Map();
            message.users?.forEach(user => {
              if (user.id !== message.userId) { // Don't add self to connected users list
                initialUsers.set(user.id, { ...user });
              }
            });
            setConnectedUsers(initialUsers);
            break;

          case 'userMoved':
            if (message.userId !== userId) { // Don't track self movement here
              setConnectedUsers(prev => new Map(prev).set(message.userId, {
                id: message.userId,
                name: message.name,
                lat: message.lat,
                lon: message.lon
              }));
            }
            break;

          case 'userLeft':
            setConnectedUsers(prev => {
              const newMap = new Map(prev);
              newMap.delete(message.userId);
              return newMap;
            });
            // Also close any active chat window with this user
            setActiveChats(prev => {
               const newChats = new Map(prev);
               newChats.delete(message.userId);
               return newChats;
            });
            break;

          case 'chatRequest':
             // Avoid duplicate requests
             setChatRequests(prev => {
                if (prev.some(req => req.senderId === message.senderId)) {
                    return prev;
                }
                return [...prev, { senderId: message.senderId, senderName: message.senderName }];
             });
             break;

          case 'chatAccept':
             // Open a chat window with the user who accepted
             console.log(`Chat accepted by ${message.senderName} (${message.senderId})`);
             setActiveChats(prev => new Map(prev).set(message.senderId, {
                name: message.senderName || `User ${message.senderId.substring(0,4)}`,
                messages: [] // Start with empty messages
             }));
             break;

          case 'privateMessage':
             // Add message to the correct chat window
             setActiveChats(prev => {
                const newChats = new Map(prev);
                const chat = newChats.get(message.senderId);
                if (chat) {
                   chat.messages.push({ senderId: message.senderId, senderName: message.senderName, message: message.message });
                } else {
                   // If chat window isn't open, maybe open it automatically or notify user?
                   // For now, just log it if chat isn't active
                   console.log(`Received private message from ${message.senderName} but chat window not open.`);
                   // Optionally auto-open chat:
                   // newChats.set(message.senderId, { name: message.senderName, messages: [message] });
                }
                return newChats;
             });
             break;

          default:
            console.log('App ignoring WebSocket message type:', message.type);
        }
      } catch (err) {
        console.error('Failed to parse App WebSocket message:', err);
      }
    };
  }, [currentUser, userId]); // Dependencies for connection logic

  // Effect to connect WebSocket when user logs in
  useEffect(() => {
    if (currentUser && !ws.current) {
      connectWebSocket();
    }
    // Cleanup on logout
    return () => {
      if (!currentUser) {
        ws.current?.close();
      }
    };
  }, [currentUser, connectWebSocket]);


  // --- Send Message Helper ---
  const sendWsMessage = useCallback((message) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
      console.log('App Sent WS Message:', message);
    } else {
      console.error('Cannot send WS message - WebSocket not open.');
    }
  }, []);


  // --- Chat Request/Accept/Send Logic ---
  const handleRequestChat = useCallback((recipientId) => {
     console.log(`Requesting chat with ${recipientId}`);
     sendWsMessage({ type: 'chatRequest', recipientId });
     // Optionally provide feedback to user that request was sent
  }, [sendWsMessage]);

  const handleAcceptChat = useCallback((senderId, senderName) => {
     console.log(`Accepting chat with ${senderName} (${senderId})`);
     // Remove request from list
     setChatRequests(prev => prev.filter(req => req.senderId !== senderId));
     // Notify sender
     sendWsMessage({ type: 'chatAccept', recipientId: senderId });
     // Open chat window locally
     setActiveChats(prev => new Map(prev).set(senderId, {
        name: senderName || `User ${senderId.substring(0,4)}`,
        messages: []
     }));
  }, [sendWsMessage]);

  const handleDeclineChat = useCallback((senderId) => {
     console.log(`Declining chat with ${senderId}`);
     setChatRequests(prev => prev.filter(req => req.senderId !== senderId));
     // Optionally notify sender (requires new WS message type)
  }, []);

  const handleSendPrivateMessage = useCallback((recipientId, messageText) => {
     const message = {
        type: 'privateMessage',
        recipientId: recipientId,
        message: messageText
     };
     sendWsMessage(message);
     // Add own message to the local chat state immediately
     setActiveChats(prev => {
        const newChats = new Map(prev);
        const chat = newChats.get(recipientId);
        if (chat) {
           chat.messages.push({ senderId: userId, senderName: currentUser.username, message: messageText });
        }
        return newChats;
     });
  }, [sendWsMessage, userId, currentUser?.username]);

   const handleCloseChat = useCallback((recipientId) => {
      setActiveChats(prev => {
         const newChats = new Map(prev);
         newChats.delete(recipientId);
         return newChats;
      });
   }, []);


  // --- Authentication Handlers ---
   const handleLoginSuccess = (userData) => {
     console.log('App received login success:', userData);
     setCurrentUser(userData);
     localStorage.setItem('mapChatUser', JSON.stringify(userData));
     // WebSocket connection will be initiated by the useEffect hook
   };

   const handleLogout = () => {
     ws.current?.close(); // Close WebSocket connection
     setCurrentUser(null);
     localStorage.removeItem('mapChatUser');
     console.log('User logged out');
   };

   // --- Effect to check for persisted login state on load ---
   useEffect(() => {
     const storedUser = localStorage.getItem('mapChatUser');
     if (storedUser) {
       try {
         const parsedUser = JSON.parse(storedUser);
         setCurrentUser(parsedUser);
         console.log('Restored user session:', parsedUser);
         // WebSocket connection will be initiated by the other useEffect hook
       } catch (error) {
         console.error('Failed to parse stored user data:', error);
         localStorage.removeItem('mapChatUser'); // Clear invalid data
       }
     }
   }, []); // Empty dependency array means run only once on mount


   // --- Render Logic ---
   if (currentUser) {
     // --- Logged In View ---
     return (
       <div className="App">
         <div className="user-info">
           <span>Welcome, {currentUser.username}! (ID: {userId?.substring(0, 4) ?? '...'})</span>
           <span style={{ marginLeft: '15px' }}>WebSocket: {isConnected ? 'Connected' : 'Disconnected'}</span>
           <button onClick={handleLogout} style={{ marginLeft: '15px' }}>Logout</button>
         </div>

         {/* Incoming Chat Requests */}
         {chatRequests.length > 0 && (
           <div className="chat-requests">
             <h4>Incoming Chat Requests:</h4>
             {chatRequests.map(req => (
               <div key={req.senderId} className="chat-request">
                 <span>{req.senderName || `User ${req.senderId.substring(0,4)}`} wants to chat.</span>
                 <button onClick={() => handleAcceptChat(req.senderId, req.senderName)}>Accept</button>
                 <button onClick={() => handleDeclineChat(req.senderId)}>Decline</button>
               </div>
             ))}
           </div>
         )}

         {/* Render the Map component, passing necessary props */}
         <MapComponent
           currentUser={currentUser}
           connectedUsers={connectedUsers} // Pass connected users data
           sendWsMessage={sendWsMessage} // Pass function to send WS messages (e.g., location)
           onRequestChat={handleRequestChat} // Pass function to initiate chat request
           userId={userId} // Pass own user ID
         />

         {/* Render Active Private Chat Windows */}
         <div className="active-chats-container">
           {Array.from(activeChats.entries()).map(([chatUserId, chatData]) => (
             <PrivateChat
               key={chatUserId}
               recipientId={chatUserId}
               recipientName={chatData.name}
               messages={chatData.messages}
               onSendMessage={handleSendPrivateMessage}
               onClose={handleCloseChat} // Pass the close handler
               currentUserId={userId}
             />
           ))}
         </div>

       </div>
     );
   } else {
     // --- Logged Out View (Login/Register Forms) ---
     return (
       <div className="App">
         <h1>MapChat</h1>
         {showLogin ? (
           <>
             <Login onLoginSuccess={handleLoginSuccess} />
             <p>
               Don't have an account?{' '}
               <button onClick={() => setShowLogin(false)}>Register</button>
             </p>
           </>
         ) : (
           <>
             <Register onRegisterSuccess={() => setShowLogin(true)} /> {/* Switch to login after successful registration */}
             <p>
               Already have an account?{' '}
               <button onClick={() => setShowLogin(true)}>Login</button>
             </p>
           </>
         )}
       </div>
     );
   }
 }

 export default App;
