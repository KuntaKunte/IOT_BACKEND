// Load environment variables from .env file
import "dotenv/config";
import { connect } from 'mqtt';
import { pool } from './db.js';

// MQTT URL can be overridden via env var (default to mosquitto service)
const MQTT_URL = process.env.MQTT_URL || 'mqtt://mosquitto:1883';

// Wait for Postgres to be ready with retries
async function waitForPostgres(retries = 10, delayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('SELECT 1');
      console.log('Postgres is ready');
      return;
    } catch (err) {
      console.log(`Postgres not ready, retrying (${i + 1}/${retries})...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error('Postgres did not become ready in time');
}

let client;

async function start() {
  await waitForPostgres();

  // Connect to MQTT broker with automatic reconnects
  client = connect(MQTT_URL, { reconnectPeriod: 2000 });

  client.on('connect', () => {
    client.subscribe('solar/+/telemetry');
    console.log('MQTT connected');
  });

  client.on('reconnect', () => {
    console.log('MQTT reconnecting...');
  });

  client.on('offline', () => {
    console.log('MQTT offline');
  });

  client.on('close', () => {
    console.log('MQTT connection closed');
  });

  // Handle connection errors to avoid an uncaught 'error' event crashing the process
  client.on('error', (err) => {
    console.error('MQTT error:', err && err.message ? err.message : err);
    // Let the client attempt reconnection (reconnectPeriod) instead of exiting
  });

  client.on('message', async (topic, message) => {
    const data = JSON.parse(message.toString());

    await pool.query(
      `INSERT INTO telemetry
       (device_id, pv_voltage, battery_voltage, current, temperature, ts)
       VALUES ($1,$2,$3,$4,$5, NOW())`,
      [
        data.device_id,
        data.pv_voltage,
        data.battery_voltage,
        data.current,
        data.temperature,
      ]
    );

    console.log('Saved telemetry:', data.device_id);
  });

  // Import and start the API server
  import('./api.js');
}

start().catch(err => {
  console.error('Failed to start services:', err);
  process.exit(1);
});

// Graceful shutdown
async function shutdown() {
  console.log('Shutting down...');
  try {
    if (client) {
      client.end(true);
      console.log('MQTT client disconnected');
    }
    if (pool) {
      await pool.end();
      console.log('Postgres pool closed');
    }
  } catch (err) {
    console.error('Error during shutdown', err);
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
