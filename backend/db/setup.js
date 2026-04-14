const db = require('./index');

const createTables = async () => {
    const tableQueries = `
        -- 1. Create Users Table
        CREATE TABLE IF NOT EXISTS users (
            email VARCHAR(255) PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            role VARCHAR(20) DEFAULT 'USER',
            chat_webhook_url TEXT,
            total_duty_count INT DEFAULT 0,
            priority_next BOOLEAN DEFAULT FALSE,
            last_duty_date DATE,
            is_active BOOLEAN DEFAULT TRUE
        );

        -- 2. Create Assignments Table
        CREATE TABLE IF NOT EXISTS assignments (
            duty_date DATE PRIMARY KEY,
            user_email VARCHAR(255) REFERENCES users(email),
            status VARCHAR(20) DEFAULT 'PENDING',
            is_manual_override BOOLEAN DEFAULT FALSE,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- 3. Create Audit Logs Table
        CREATE TABLE IF NOT EXISTS audit_logs (
            id SERIAL PRIMARY KEY,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            action_type VARCHAR(50) NOT NULL,
            actor_email VARCHAR(255),
            target_date DATE,
            details TEXT NOT NULL
        );
    `;

    try {
        console.log('⏳ Creating database tables...');
        await db.query(tableQueries);
        console.log('✅ Tables created successfully!');
    } catch (err) {
        console.error('❌ Error creating tables:', err.message);
    } finally {
        process.exit(); // Stop the script once it's done
    }
};

createTables();