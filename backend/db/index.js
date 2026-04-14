const { Pool } = require('pg');
const path = require('path');
// This guarantees it looks exactly one folder up from the 'db' folder
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Create a connection pool using the URL from your .env file
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// Test the connection
pool.on('connect', () => {
    console.log('📦 Connected to the PostgreSQL database');
});

module.exports = {
    query: (text, params) => pool.query(text, params),
};