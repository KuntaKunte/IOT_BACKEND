// Import Express framework for building the web server
import express from "express";
// Import Pool from pg library for PostgreSQL database connections
import { Pool } from "pg";

// Create an Express application instance
const app = express();

// Middleware to capture raw JSON bodies and parse them safely
app.use(express.text({ type: 'application/json' }));
app.use((req, res, next) => {
  if (req.headers['content-type']?.includes('application/json')) {
    if (!req.body) {
      req.body = {};
      return next();
    }

    try {
      req.body = JSON.parse(req.body);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid JSON in request body' });
    }
  }
  next();
});

// Generic error handler (avoids process crash on uncaught errors)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Use CommonJS DB helper for query logic (keeps DB logic testable)
import {
  fetchTelemetry,
  fetchDevices,
  insertCommand,
  fetchErrors,
  fetchCommands,
  deleteCommands,
  fetchTelemetryStats,
  fetchTelemetryByDateRange,
  fetchAllDevicesStats,
  createDeviceToken,
  validateDeviceToken,
  createApiKey,
  validateApiKey,
  logAuditEvent,
  aggregateTelemetryHourly,
  checkDeviceAnomalies
} from './db.js';

// API Key authentication middleware
const authenticateApiKey = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required. Use X-API-Key header.' });
  }
  
  try {
    const keyRecord = await validateApiKey(apiKey);
    if (!keyRecord) {
      return res.status(403).json({ error: 'Invalid or expired API key' });
    }
    req.user = { userId: keyRecord.user_id };
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Define a GET endpoint to retrieve telemetry data for a specific device
app.get("/api/telemetry/:deviceId", async (req, res) => {
  // Extract deviceId from the URL parameters
  const { deviceId } = req.params;
  // Query the database for the latest 100 telemetry records for the device, ordered by timestamp descending
  const rows = await fetchTelemetry(deviceId);
  // Send the query results as JSON response
  res.json(rows);
});

// Get all devices
app.get("/api/devices", async (req, res) => {
  try {
    const devices = await fetchDevices();
    res.json(devices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send command to device
app.post("/api/devices/:deviceId/commands", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { command, parameters } = req.body;
    const commandId = await insertCommand(deviceId, command, parameters);
    res.json({ command_id: commandId, status: 'pending' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete command history for a device
app.delete("/api/devices/:deviceId/commands", async (req, res) => {
  try {
    const { deviceId } = req.params;
    await deleteCommands(deviceId);
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get errors for a device
app.get("/api/devices/:deviceId/errors", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const errors = await fetchErrors(deviceId);
    res.json(errors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get command history for a device
app.get("/api/devices/:deviceId/commands", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const commands = await fetchCommands(deviceId);
    res.json(commands);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get analytics for a specific device
app.get("/api/devices/:deviceId/analytics", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const stats = await fetchTelemetryStats(deviceId);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get telemetry data for a device within a date range
app.get("/api/devices/:deviceId/telemetry/range", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate query parameters are required' });
    }
    
    const telemetry = await fetchTelemetryByDateRange(deviceId, startDate, endDate);
    res.json(telemetry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get analytics for all devices
app.get("/api/analytics/devices", async (req, res) => {
  try {
    const allStats = await fetchAllDevicesStats();
    res.json(allStats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send bulk commands to multiple devices
app.post("/api/devices/commands/bulk", async (req, res) => {
  try {
    const { deviceIds, command } = req.body;
    
    if (!deviceIds || !Array.isArray(deviceIds) || deviceIds.length === 0) {
      return res.status(400).json({ error: 'deviceIds must be a non-empty array' });
    }
    
    if (!command || typeof command !== 'string') {
      return res.status(400).json({ error: 'command must be a non-empty string' });
    }
    
    const results = [];
    for (const deviceId of deviceIds) {
      try {
        await insertCommand(deviceId, command);
        results.push({ deviceId, status: 'success' });
      } catch (err) {
        results.push({ deviceId, status: 'error', error: err.message });
      }
    }
    
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PRODUCTION-GRADE FEATURES: Authentication & Security
// ============================================

// Create a new API key for user
app.post("/api/auth/keys", authenticateApiKey, async (req, res) => {
  try {
    const { description } = req.body;
    if (!description) {
      return res.status(400).json({ error: 'Description is required' });
    }
    
    const newKey = await createApiKey(req.user.userId, description);
    await logAuditEvent(req.user.userId, 'CREATE_API_KEY', newKey.id, { description });
    res.json({ api_key: newKey.api_key, message: 'Save this key securely. It will not be displayed again.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create device authentication token
app.post("/api/auth/device-tokens", authenticateApiKey, async (req, res) => {
  try {
    const { deviceId } = req.body;
    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID is required' });
    }
    
    const token = await createDeviceToken(deviceId);
    await logAuditEvent(req.user.userId, 'CREATE_DEVICE_TOKEN', deviceId, {});
    res.json({ device_token: token.token, expires_at: token.expires_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PRODUCTION-GRADE FEATURES: Data Pipelines & Analytics
// ============================================

// Trigger hourly telemetry aggregation
app.post("/api/analytics/aggregate", authenticateApiKey, async (req, res) => {
  try {
    const result = await aggregateTelemetryHourly();
    await logAuditEvent(req.user.userId, 'AGGREGATE_TELEMETRY', 'system', { rows_affected: result.length });
    res.json({ status: 'ok', rows_processed: result.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get device alerts and anomalies
app.get("/api/devices/:deviceId/alerts", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const anomalies = await checkDeviceAnomalies(deviceId);
    res.json(anomalies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get device health summary
app.get("/api/devices/:deviceId/health", async (req, res) => {
  try {
    const { deviceId } = req.params;
    
    // Get latest telemetry
    const telemetry = await fetchTelemetry(deviceId);
    const latest = telemetry[0];
    
    // Check for anomalies
    const anomalies = await checkDeviceAnomalies(deviceId);
    
    // Get error count
    const errors = await fetchErrors(deviceId);
    const errorCount = errors.length;
    
    const health = {
      device_id: deviceId,
      status: anomalies.length > 0 ? 'warning' : 'healthy',
      last_reading: latest ? latest.ts : null,
      anomaly_count: anomalies.length,
      error_count: errorCount,
      latest_data: latest
    };
    
    res.json(health);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// System health endpoint (requires auth)
app.get("/api/system/health", authenticateApiKey, async (req, res) => {
  try {
    const devices = await fetchDevices();
    const deviceCount = devices.length;
    const onlineCount = devices.filter(d => d.status === 'online').length;
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      devices: {
        total: deviceCount,
        online: onlineCount
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

let server;

// Start the server on port 3000 when not running tests
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(3000, () => console.log('API running on port 3000'));
}

// Graceful shutdown for the API server
async function shutdownApi() {
  if (server) {
    await new Promise(resolve => server.close(resolve));
    console.log('API server closed');
  }
}

process.on('SIGINT', shutdownApi);
process.on('SIGTERM', shutdownApi);

export default app;