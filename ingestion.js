// Load environment variables from .env file
import "dotenv/config";
import { connect } from 'mqtt';
import { pool, upsertDevice, insertError, updateCommandStatus, fetchPendingCommands } from './db.js';

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
    client.subscribe('solar/+/status');
    client.subscribe('solar/+/response');
    console.log('MQTT connected and subscribed to topics');
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

  // Periodically check for pending commands and send them
  setInterval(async () => {
    try {
      // Get all devices
      const devicesResult = await pool.query('SELECT device_id FROM devices');
      const devices = devicesResult.rows;

      for (const device of devices) {
        const pendingCommands = await fetchPendingCommands(device.device_id);
        for (const cmd of pendingCommands) {
          const commandPayload = {
            command_id: cmd.id,
            command: cmd.command,
            parameters: cmd.parameters
          };
          const topic = `solar/${device.device_id}/commands`;
          client.publish(topic, JSON.stringify(commandPayload));
          console.log('Sent command to device:', device.device_id, cmd.command);
        }
      }
    } catch (err) {
      console.error('Error sending commands:', err);
    }
  }, 10000); // Check every 10 seconds

  client.on('message', async (topic, message) => {
    try {
      const parts = topic.split('/');
      const deviceId = parts[1];
      const messageType = parts[2];
      const data = JSON.parse(message.toString());

      if (messageType === 'telemetry') {
        // Store telemetry data
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

        // Update device status
        await upsertDevice(deviceId, 'online');

        console.log('Saved telemetry:', data.device_id);
      } else if (messageType === 'status') {
        // Update device status
        await upsertDevice(deviceId, data.status || 'online');
        console.log('Updated status for device:', deviceId, data.status);
      } else if (messageType === 'response') {
        // Handle command response
        if (data.command_id) {
          await updateCommandStatus(data.command_id, data.status || 'completed');
          console.log('Updated command status:', data.command_id, data.status);
        }
      }
    } catch (err) {
      console.error('Error processing message:', err);
      // Try to extract device_id from topic or data
      const parts = topic.split('/');
      const deviceId = parts[1];
      await insertError(deviceId, 'message_processing', err.message);
    }
  });
}

start().catch(err => {
  console.error('Failed to start ingestion service:', err);
  process.exit(1);
});

// Graceful shutdown
async function shutdown() {
  console.log('Shutting down ingestion...');
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
