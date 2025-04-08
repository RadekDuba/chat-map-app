import React, { useState } from 'react';

function Register({ onRegisterSuccess }) { // Assume onRegisterSuccess is passed
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccessMessage('');
    setLoading(true);

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      setLoading(false);
      return;
    }

    try {
      // Note: Adjust the URL if your worker is deployed or running on a different port
      const response = await fetch('/api/register', { // Relative URL assumes proxy or same origin
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          username,
          password,
          age: age ? parseInt(age, 10) : null, // Send age as number or null
          gender: gender || null, // Send gender or null
         }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
      }

      console.log('Registration successful:', data);
      setSuccessMessage('Registration successful! You can now log in.');
      // Optionally call onRegisterSuccess if needed for immediate login or state update
      if (onRegisterSuccess) {
        onRegisterSuccess(data); // Pass registration data up
      }
      // Clear form potentially? Or redirect to login?

    } catch (err) {
      console.error('Registration failed:', err);
      setError(err.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2>Register</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="register-email">Email:</label>
          <input
            type="email"
            id="register-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="register-username">Username:</label>
          <input
            type="text"
            id="register-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="register-password">Password:</label>
          <input
            type="password"
            id="register-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength="8"
          />
        </div>
         <div>
          <label htmlFor="register-age">Age (Optional):</label>
          <input
            type="number"
            id="register-age"
            value={age}
            onChange={(e) => setAge(e.target.value)}
          />
        </div>
         <div>
          <label htmlFor="register-gender">Gender (Optional):</label>
          <input
            type="text"
            id="register-gender"
            value={gender}
            onChange={(e) => setGender(e.target.value)}
          />
        </div>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        {successMessage && <p style={{ color: 'green' }}>{successMessage}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Registering...' : 'Register'}
        </button>
      </form>
    </div>
  );
}

export default Register;
