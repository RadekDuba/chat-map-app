import React, { useState } from 'react';

function Login({ onLoginSuccess }) { // Assume onLoginSuccess is passed to update app state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Construct the absolute URL using the environment variable
      const workerApiUrl = import.meta.env.VITE_WORKER_API_URL || ''; // Fallback to empty string if not set
      if (!workerApiUrl) {
         console.error("Worker API URL is not configured. Set VITE_WORKER_API_URL.");
         setError("Application configuration error.");
         setLoading(false);
         return;
      }
      const apiUrl = `${workerApiUrl}/api/login`;
      console.log("Login Fetch URL:", apiUrl); // Log the URL being used

      const response = await fetch(apiUrl, { // Use the absolute URL
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
      }

      console.log('Login successful:', data.user);
      // Store user info/token and update app state
      if (onLoginSuccess) {
        onLoginSuccess(data.user); // Pass user data up
      }

    } catch (err) {
      console.error('Login failed:', err);
      setError(err.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2>Login</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="login-email">Email:</label>
          <input
            type="email"
            id="login-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="login-password">Password:</label>
          <input
            type="password"
            id="login-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Logging in...' : 'Login'}
        </button>
      </form>
    </div>
  );
}

export default Login;
