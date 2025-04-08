import React, { useState, useEffect, useRef, useCallback } from 'react';
import './PrivateChat.css'; // Create this file for styling

function PrivateChat({
  recipientId,
  recipientName,
  messages = [], // Default to empty array
  onSendMessage,
  onClose,
  currentUserId
}) {
  const [newMessage, setNewMessage] = useState('');
  const messagesEndRef = useRef(null);

  // --- Auto-scroll to bottom ---
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]); // Scroll when messages change

  // --- Send Message Handler ---
  const handleSendMessage = useCallback((event) => {
    event.preventDefault();
    if (newMessage.trim()) {
      onSendMessage(recipientId, newMessage.trim()); // Call handler passed from App.jsx
      setNewMessage(''); // Clear input field
    }
  }, [newMessage, recipientId, onSendMessage]);

  return (
    <div className="private-chat-window">
      <div className="chat-header">
        <h4>Chat with {recipientName}</h4>
        <button onClick={() => onClose(recipientId)} className="close-btn">X</button>
      </div>
      <div className="chat-messages">
        {messages.map((msg, index) => (
          <div key={index} className={`message ${msg.senderId === currentUserId ? 'my-message' : 'other-message'}`}>
            {/* Don't need sender name prefix in private chat unless it's a group */}
            {msg.message}
          </div>
        ))}
        <div ref={messagesEndRef} /> {/* Anchor for scrolling */}
      </div>
      <form onSubmit={handleSendMessage} className="chat-input-form">
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Type your message..."
          autoFocus // Focus input when chat opens
        />
        <button type="submit" disabled={!newMessage.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

export default PrivateChat;
