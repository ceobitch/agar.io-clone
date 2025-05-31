"use strict";

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const config = require('../../config');
const sqlInfo = config.sqlinfo;
let db;

// Check if we're running in a serverless environment
if (process.env.VERCEL) {
  // Use in-memory database for serverless
  console.log('Using in-memory SQLite database for serverless environment');
  db = new sqlite3.Database(':memory:', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, err => {
    if (err) {
      console.error('Error creating in-memory database:', err);
    } else {
      console.log('Connected to in-memory SQLite database');
      initializeTables();
    }
  });
} else {
  // Use file-based database for local development
  const dbPath = path.join(__dirname, 'db', sqlInfo.fileName);
  const dbFolder = path.dirname(dbPath);

  // Ensure the database folder exists
  if (!fs.existsSync(dbFolder)) {
    fs.mkdirSync(dbFolder, {
      recursive: true
    });
    console.log(`Created the database folder: ${dbFolder}`);
  }

  // Create the database connection
  db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, err => {
    if (err) {
      console.error('Error connecting to database:', err);
    } else {
      console.log('Connected to the SQLite database');
      initializeTables();
    }
  });
}
function initializeTables() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS failed_login_attempts (
            username TEXT,
            ip_address TEXT
        )`, err => {
      if (err) {
        console.error('Error creating failed_login_attempts table:', err);
      } else {
        console.log("Created failed_login_attempts table");
      }
    });
    db.run(`CREATE TABLE IF NOT EXISTS chat_messages (
            username TEXT,
            message TEXT,
            ip_address TEXT,
            timestamp INTEGER
        )`, err => {
      if (err) {
        console.error('Error creating chat_messages table:', err);
      } else {
        console.log("Created chat_messages table");
      }
    });
  });
}

// Only close the database connection if we're not in a serverless environment
if (!process.env.VERCEL) {
  process.on('beforeExit', () => {
    db.close(err => {
      if (err) {
        console.error('Error closing the database connection:', err);
      } else {
        console.log('Closed the database connection');
      }
    });
  });
}
module.exports = db;