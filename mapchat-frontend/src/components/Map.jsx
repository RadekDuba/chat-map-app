import React, { useRef, useEffect, useState, useCallback, memo } from 'react'; // Added memo
import * as maptilersdk from '@maptiler/sdk';
import '@maptiler/sdk/dist/maptiler-sdk.css';
import './Map.css';

// Helper function to generate a random color for markers (can be moved to a utils file)
const getRandomColor = () => {
  const letters = '0123456789ABCDEF';
  let color = '#';
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}; // <-- Added missing closing brace


// Memoize the component to prevent unnecessary re-renders if props haven't changed significantly
const MapComponent = memo(({ currentUser, connectedUsers, onRequestChat, userId, onPositionUpdate }) => { // Removed sendWsMessage, added onPositionUpdate
  const mapContainer = useRef(null);
  const map = useRef(null);
  // No longer need ws ref here, managed by App.jsx
  const userMarker = useRef(null); // Marker for the current user
  const otherUserMarkers = useRef(new Map()); // Map<userId, { marker: maptilersdk.Marker, data: userData }>
  const [mapCenterLng, setMapCenterLng] = useState(14.4378); // Default longitude (Prague)
  const [mapCenterLat, setMapCenterLat] = useState(50.0755); // Default latitude (Prague)
  const [mapZoom, setMapZoom] = useState(10);
  const [userPosition, setUserPosition] = useState(null); // Current user's position [lng, lat]
  // No longer need isConnected or userId state here, passed as props

  // --- MapTiler API Key ---
  // Read from environment variable (set in Cloudflare Pages settings)
  const apiKey = import.meta.env.VITE_MAPTILER_API_KEY;
  if (!apiKey) {
    console.error("MapTiler API key is missing! Set VITE_MAPTILER_API_KEY environment variable.");
    // Optionally render an error message or fallback
  }

  // --- Initialize Map ---
  useEffect(() => {
    if (map.current) return; // Initialize map only once

    maptilersdk.config.apiKey = apiKey;
    map.current = new maptilersdk.Map({
      container: mapContainer.current,
      style: maptilersdk.MapStyle.STREETS, // Choose a map style
      center: [mapCenterLng, mapCenterLat], // Use state for initial center
      zoom: mapZoom, // Use state for initial zoom
    });

    // Add zoom and rotation controls
    map.current.addControl(new maptilersdk.NavigationControl(), 'top-right');

    // Cleanup function to remove map on component unmount
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, [apiKey]); // Initialize map only once based on API key

  // --- Get User Geolocation & Update Own Marker ---
  useEffect(() => {
    // Function to handle position update for the current user
    const handlePositionUpdate = (pos) => {
      const newPos = [pos.coords.longitude, pos.coords.latitude];
      console.log('Map Geolocation update:', newPos);
      setUserPosition(newPos); // Update local state for own marker

      // Pass position update up to App component
      if (onPositionUpdate && newPos && newPos.length === 2 && typeof newPos[0] === 'number' && typeof newPos[1] === 'number') {
        onPositionUpdate(newPos);
      }
    };

     // Get initial position
     navigator.geolocation.getCurrentPosition(
       (pos) => {
         const initialPos = [pos.coords.longitude, pos.coords.latitude];
         console.log('Map Initial Geolocation success:', initialPos);
         setMapCenterLng(initialPos[0]); // Update map center state
         setMapCenterLat(initialPos[1]);
         setMapZoom(14); // Zoom in
         setUserPosition(initialPos); // Set own position state
         if (map.current) {
           map.current.setCenter(initialPos);
           map.current.setZoom(14);
         }
         handlePositionUpdate(pos); // Send initial position via WebSocket
       },
       (err) => {
         console.warn(`Map Initial Geolocation ERROR(${err.code}): ${err.message}`);
         // Keep default map center if geolocation fails
         if (map.current) {
           map.current.setCenter([mapCenterLng, mapCenterLat]);
           map.current.setZoom(mapZoom);
         }
       },
       { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
     );

     // Set up watching for position changes
     const watchId = navigator.geolocation.watchPosition(
       handlePositionUpdate, // This now also sends WS message
       (err) => {
         console.warn(`Map Geolocation Watch ERROR(${err.code}): ${err.message}`);
       },
       { enableHighAccuracy: true, timeout: 10000, maximumAge: 0, distanceFilter: 10 } // Update if moved 10 meters
     );

     // Cleanup watcher on component unmount
     return () => navigator.geolocation.clearWatch(watchId);

  }, [onPositionUpdate, currentUser.username]); // Updated dependencies


   // --- Update Current User Marker ---
   useEffect(() => {
     if (!map.current || !userPosition) return;

     if (userMarker.current) {
       userMarker.current.setLngLat(userPosition);
     } else {
       userMarker.current = new maptilersdk.Marker({ color: '#FF0000' }) // Red marker for current user
         .setLngLat(userPosition)
         .setPopup(new maptilersdk.Popup({ closeButton: false }).setText(`You are here! (${currentUser.username})`)) // Disable close button
         .addTo(map.current);
     }
   }, [userPosition, currentUser.username]); // Re-run when userPosition or username changes


   // --- Update Other User Markers based on connectedUsers prop ---
   useEffect(() => {
     if (!map.current) return;

     const currentMarkerIds = new Set(otherUserMarkers.current.keys());
     const incomingUserIds = new Set(connectedUsers.keys());

     // Add/Update markers for incoming users
     connectedUsers.forEach((userData, id) => {
       const position = [userData.lon, userData.lat];
       const popupContent = document.createElement('div'); // Create div for popup content

       const nameElement = document.createElement('span');
       nameElement.textContent = `User: ${userData.name || id.substring(0, 4)}`;
       popupContent.appendChild(nameElement);

       // Only add chat button if the marker is not for the current user
       if (id !== userId) {
           const buttonElement = document.createElement('button');
           buttonElement.textContent = 'Request Chat';
           buttonElement.style.marginLeft = '10px';
           buttonElement.onclick = () => onRequestChat(id); // Call handler from App.jsx
           popupContent.appendChild(buttonElement);
       }


       if (otherUserMarkers.current.has(id)) {
         // Update existing marker position and potentially popup
         const existing = otherUserMarkers.current.get(id);
         existing.marker.setLngLat(position);
         existing.marker.getPopup().setDOMContent(popupContent); // Update popup content
         existing.data = userData; // Update stored data
       } else {
         // Create new marker
         const color = getRandomColor();
         const newMarker = new maptilersdk.Marker({ color: color })
           .setLngLat(position)
           .setPopup(new maptilersdk.Popup({ closeButton: false }).setDOMContent(popupContent)) // Disable close button
           .addTo(map.current);
         otherUserMarkers.current.set(id, { marker: newMarker, data: userData });
       }
     });

     // Remove markers for users who are no longer connected
     currentMarkerIds.forEach(id => {
       if (!incomingUserIds.has(id)) {
         otherUserMarkers.current.get(id).marker.remove();
         otherUserMarkers.current.delete(id);
         console.log(`Removed marker for disconnected user ${id}`);
       }
     });

   }, [connectedUsers, onRequestChat, userId]); // Added userId dependency for the check inside


   return (
     <div className="map-wrap">
       {/* Removed the status display, App.jsx can show overall status */}
       <div ref={mapContainer} className="map" />
     </div>
   );
 }); // End of memoized component

 export default MapComponent;
