import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Import Express framework for building the web server
import express from "express";

// Create an Express application instance
const app = express();
// Use built-in body parsers for JSON and URL-encoded forms
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3001',
  'http://localhost:5173'
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

function parseCookies(req) {
  const cookies = {};
  const header = req.headers?.cookie;
  if (!header) return cookies;

  header.split(';').forEach((cookie) => {
    const [name, ...rest] = cookie.split('=');
    if (!name) return;
    cookies[name.trim()] = decodeURIComponent(rest.join('=').trim());
  });

  return cookies;
}

const authCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
};

const accessTokenCookieOptions = {
  ...authCookieOptions,
  maxAge: 15 * 60 * 1000, // 15 minutes
};

const refreshTokenCookieOptions = {
  ...authCookieOptions,
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
};

const getAccessTokenFromRequest = (req) => {
  const headerToken = req.headers['x-api-key'];
  if (headerToken) return headerToken;
  const cookies = parseCookies(req);
  return cookies.access_token;
};

const getRefreshTokenFromRequest = (req) => {
  const cookies = parseCookies(req);
  return cookies.refresh_token;
};

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
  revokeApiKey,
  createAccessToken,
  validateAccessToken,
  revokeAccessToken,
  createRefreshToken,
  validateRefreshToken,
  revokeRefreshToken,
  logAuditEvent,
  aggregateTelemetryHourly,
  checkDeviceAnomalies,
  fetchSites,
  getUsersCount,
  createUser,
  verifyUserCredentials,
  getUserById,
  pool,
  fetchSiteById,
  fetchSiteDevices,
  upsertSite,
  fetchDashboardSummary,
  fetchAlerts,
  resolveAlert,
  getActiveAlertsCount,
  fetchWeeklyReports,
  generateWeeklyReport,
  getBatteryConfig,
  setBatteryConfig,
  calculateBatteryPercentage,
  isBatteryCritical,
  isBatteryWarning,
  addAlertSubscriber,
  removeAlertSubscriber,
  getAlertSubscribers,
  checkOfflineSites,
  hasActiveOfflineAlert,
  hasActiveBatteryCriticalAlert
} from './db.js';

// API Key and cookie authentication middleware
const authenticateApiKey = async (req, res, next) => {
  const authToken = getAccessTokenFromRequest(req);

  if (!authToken) {
    return res.status(401).json({ error: 'Authentication required. Use X-API-Key header or login via the frontend.' });
  }

  try {
    let keyRecord = await validateApiKey(authToken);
    if (!keyRecord) {
      keyRecord = await validateAccessToken(authToken);
    }

    if (!keyRecord) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    req.user = {
      userId: keyRecord.user_id,
      username: keyRecord.username,
      roles: keyRecord.roles || []
    };
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

async function initializeDatabase() {
  try {
    const result = await pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users'"
    );

    if (result.rowCount === 0) {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const schemaPath = path.join(__dirname, 'db', 'schema.sql');
      const schemaSql = await fs.readFile(schemaPath, 'utf8');

      await pool.query(schemaSql);
      console.log('Database schema initialized from schema.sql');
    }

    await runDatabaseMigrations();
  } catch (err) {
    console.error('Failed to initialize database schema:', err);
    process.exit(1);
  }
}

async function runDatabaseMigrations() {
  try {
    const result = await pool.query(
      "SELECT data_type FROM information_schema.columns WHERE table_name = 'api_keys' AND column_name = 'user_id'"
    );

    if (result.rowCount === 1 && result.rows[0].data_type !== 'integer') {
      console.log('Migrating api_keys.user_id to integer');
      await pool.query(
        'ALTER TABLE api_keys ALTER COLUMN user_id TYPE integer USING user_id::integer'
      );
    }

    const fkResult = await pool.query(
      "SELECT constraint_name FROM information_schema.table_constraints WHERE table_name = 'api_keys' AND constraint_type = 'FOREIGN KEY'"
    );

    const hasUserFk = fkResult.rows.some(
      (row) => row.constraint_name === 'api_keys_user_id_fkey'
    );

    if (!hasUserFk) {
      console.log('Adding missing foreign key constraint on api_keys.user_id');
      await pool.query(
        'ALTER TABLE api_keys ADD CONSTRAINT api_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE'
      );
    }

    const accessTokensResult = await pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'access_tokens'"
    );

    if (accessTokensResult.rowCount === 0) {
      console.log('Creating access_tokens table');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS access_tokens (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token TEXT UNIQUE NOT NULL,
          revoked BOOLEAN DEFAULT false,
          created_at TIMESTAMP DEFAULT NOW(),
          expires_at TIMESTAMP NOT NULL
        )
      `);
    }

    const refreshTokensResult = await pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'refresh_tokens'"
    );

    if (refreshTokensResult.rowCount === 0) {
      console.log('Creating refresh_tokens table');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS refresh_tokens (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token TEXT UNIQUE NOT NULL,
          revoked BOOLEAN DEFAULT false,
          created_at TIMESTAMP DEFAULT NOW(),
          expires_at TIMESTAMP NOT NULL
        )
      `);
    }
  } catch (err) {
    console.error('Failed to run database migrations:', err);
    process.exit(1);
  }
}

async function initializeAdminUser() {
  try {
    const userCount = await getUsersCount();
    if (userCount === 0 && process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
      const roles = process.env.ADMIN_ROLES ? process.env.ADMIN_ROLES.split(',').map((r) => r.trim()) : ['admin'];
      await createUser(process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD, roles);
      console.log('Admin user created:', process.env.ADMIN_USERNAME);
    }
  } catch (err) {
    console.error('Admin initialization failed:', err);
  }
}

async function bootstrap() {
  await initializeDatabase();
  await initializeAdminUser();
}

bootstrap().catch((err) => {
  console.error('Bootstrapping failed:', err);
  process.exit(1);
});

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
app.post("/api/devices/:deviceId/commands", authenticateApiKey, async (req, res) => {
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

// Login for admin users
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await verifyUserCredentials(username, password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const accessToken = await createAccessToken(user.id, 15);
    const refreshToken = await createRefreshToken(user.id, 30);
    await logAuditEvent(user.id, 'LOGIN', user.id.toString(), { username });

    res.cookie('access_token', accessToken.token, {
      ...accessTokenCookieOptions,
      expires: new Date(accessToken.expires_at)
    });
    res.cookie('refresh_token', refreshToken.token, {
      ...refreshTokenCookieOptions,
      expires: new Date(refreshToken.expires_at)
    });

    res.json({
      user: {
        id: user.id,
        username: user.username,
        roles: user.roles
      },
      expires_at: accessToken.expires_at
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/refresh', async (req, res) => {
  try {
    const refreshToken = getRefreshTokenFromRequest(req);
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token required' });
    }

    const tokenRecord = await validateRefreshToken(refreshToken);
    if (!tokenRecord) {
      return res.status(403).json({ error: 'Invalid or expired refresh token' });
    }

    const user = await getUserById(tokenRecord.user_id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await revokeRefreshToken(refreshToken);
    const newAccessToken = await createAccessToken(user.id, 15);
    const newRefreshToken = await createRefreshToken(user.id, 30);

    res.cookie('access_token', newAccessToken.token, {
      ...accessTokenCookieOptions,
      expires: new Date(newAccessToken.expires_at)
    });
    res.cookie('refresh_token', newRefreshToken.token, {
      ...refreshTokenCookieOptions,
      expires: new Date(newRefreshToken.expires_at)
    });

    res.json({
      user: {
        id: user.id,
        username: user.username,
        roles: user.roles
      },
      expires_at: newAccessToken.expires_at
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', authenticateApiKey, async (req, res) => {
  try {
    res.json({ id: req.user.userId, username: req.user.username, roles: req.user.roles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/logout', authenticateApiKey, async (req, res) => {
  try {
    const accessToken = getAccessTokenFromRequest(req);
    const refreshToken = getRefreshTokenFromRequest(req);
    if (accessToken) {
      await revokeAccessToken(accessToken);
    }
    if (refreshToken) {
      await revokeRefreshToken(refreshToken);
    }
    await logAuditEvent(req.user.userId, 'LOGOUT', req.user.userId.toString(), {});
    res.clearCookie('access_token', accessTokenCookieOptions);
    res.clearCookie('refresh_token', refreshTokenCookieOptions);
    res.json({ status: 'ok', message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

// ============================================
// MULTI-OEM DASHBOARD & SITE MANAGEMENT
// ============================================

// Get dashboard summary with all sites and OEM distribution
app.get("/api/dashboard/summary", async (req, res) => {
  try {
    const summary = await fetchDashboardSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all sites
app.get("/api/sites", async (req, res) => {
  try {
    const sites = await fetchSites();
    res.json(sites);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get site by ID
app.get("/api/sites/:siteId", async (req, res) => {
  try {
    const { siteId } = req.params;
    const site = await fetchSiteById(siteId);
    if (!site) {
      return res.status(404).json({ error: 'Site not found' });
    }
    res.json(site);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get devices for a site
app.get("/api/sites/:siteId/devices", async (req, res) => {
  try {
    const { siteId } = req.params;
    const devices = await fetchSiteDevices(siteId);
    res.json(devices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function handleUpsertSite(req, res) {
  try {
    console.log('POST', req.path, 'received. headers:', req.headers);
    console.log('POST', req.path, 'raw body type:', typeof req.body, 'value:', req.body);

    let payload = req.body;
    if (typeof payload === 'string' && payload.length > 0) {
      try {
        payload = JSON.parse(payload);
      } catch (e) {
        console.warn(`Failed to JSON.parse req.body in ${req.path}:`, e.message);
      }
    }

    if (!payload || Object.keys(payload).length === 0) {
      payload = req.query;
      console.log(`POST ${req.path} falling back to query params:`, payload);
    }

    const { site_id, site_name, oem, location, capacity_kw } = payload;
    if (!site_id || !site_name || !oem) {
      return res.status(400).json({ error: 'site_id, site_name, and oem are required' });
    }

    await upsertSite(site_id, site_name, oem, location, capacity_kw);
    res.json({ status: 'ok', message: 'Site created/updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Create or update a site
app.post("/api/sites", authenticateApiKey, handleUpsertSite);
app.post("/api/clients", authenticateApiKey, handleUpsertSite);

// ============================================
// ALERTS MANAGEMENT
// ============================================

// Get all alerts
app.get("/api/alerts", async (req, res) => {
  try {
    const { siteId, unresolved } = req.query;
    const alerts = await fetchAlerts(siteId, unresolved === 'true');
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get active alerts count
app.get("/api/alerts/count", async (req, res) => {
  try {
    const count = await getActiveAlertsCount();
    res.json({ active_alerts: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resolve an alert
app.post("/api/alerts/:alertId/resolve", authenticateApiKey, async (req, res) => {
  try {
    const { alertId } = req.params;
    await resolveAlert(alertId);
    res.json({ status: 'ok', message: 'Alert resolved successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// WEEKLY REPORTS
// ============================================

// Get weekly reports
app.get("/api/reports/weekly", async (req, res) => {
  try {
    const { siteId, weeks } = req.query;
    const reports = await fetchWeeklyReports(siteId, weeks ? parseInt(weeks) : 12);
    res.json(reports);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate weekly report for a site
app.post("/api/reports/weekly/generate", authenticateApiKey, async (req, res) => {
  try {
    const { siteId, weekStart } = req.body;
    if (!siteId || !weekStart) {
      return res.status(400).json({ error: 'siteId and weekStart are required' });
    }
    await generateWeeklyReport(siteId, weekStart);
    res.json({ status: 'ok', message: 'Weekly report generated successfully' });
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

// ============================================
// BATTERY MANAGEMENT
// ============================================

// Get battery configuration for a device
app.get("/api/devices/:deviceId/battery-config", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const config = await getBatteryConfig(deviceId);
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set battery configuration for a device
app.post("/api/devices/:deviceId/battery-config", authenticateApiKey, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { battery_type, battery_capacity_kwh, min_voltage, max_voltage, critical_percentage, warning_percentage } = req.body;
    
    await setBatteryConfig(deviceId, {
      battery_type,
      battery_capacity_kwh,
      min_voltage,
      max_voltage,
      critical_percentage,
      warning_percentage
    });
    
    res.json({ status: 'ok', message: 'Battery configuration updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// ALERT SUBSCRIBERS
// ============================================

// Get alert subscribers
app.get("/api/alerts/subscribers", authenticateApiKey, async (req, res) => {
  try {
    const { alertType } = req.query;
    const subscribers = await getAlertSubscribers(alertType);
    res.json(subscribers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add alert subscriber
app.post("/api/alerts/subscribers", authenticateApiKey, async (req, res) => {
  try {
    const { alert_type, email } = req.body;
    
    if (!alert_type || !email) {
      return res.status(400).json({ error: 'alert_type and email are required' });
    }
    
    await addAlertSubscriber(alert_type, email);
    await logAuditEvent(req.user.userId, 'ADD_ALERT_SUBSCRIBER', email, { alert_type });
    res.json({ status: 'ok', message: 'Alert subscriber added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove alert subscriber
app.delete("/api/alerts/subscribers", authenticateApiKey, async (req, res) => {
  try {
    const { alert_type, email } = req.body;
    
    if (!alert_type || !email) {
      return res.status(400).json({ error: 'alert_type and email are required' });
    }
    
    await removeAlertSubscriber(alert_type, email);
    await logAuditEvent(req.user.userId, 'REMOVE_ALERT_SUBSCRIBER', email, { alert_type });
    res.json({ status: 'ok', message: 'Alert subscriber removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// ENHANCED MULTI-OEM DASHBOARD
// ============================================

// Get comprehensive dashboard with multi-OEM site overview
app.get("/api/dashboard/multi-oem", async (req, res) => {
  try {
    const summary = await fetchDashboardSummary();
    
    // Enhance with additional metrics
    const dashboardData = {
      timestamp: new Date().toISOString(),
      sites: summary.sites.map(site => ({
        ...site,
        health_status: site.status === 'offline' ? 'Offline' : site.status === 'ok' ? 'OK' : 'Warning',
        device_online_percentage: site.device_count > 0 ? Math.round((site.online_devices / site.device_count) * 100) : 0,
        last_activity: site.last_device_seen ? new Date(site.last_device_seen).toISOString() : 'Never'
      })),
      summary: {
        total_sites: summary.sites.length,
        online_sites: summary.sites.filter(s => s.status === 'ok').length,
        warning_sites: summary.sites.filter(s => s.status === 'warning').length,
        offline_sites: summary.sites.filter(s => s.status === 'offline').length,
        active_alerts: summary.activeAlerts,
        oem_distribution: summary.oemDistribution
      }
    };
    
    res.json(dashboardData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get site health status with battery and alert details
app.get("/api/sites/:siteId/health", async (req, res) => {
  try {
    const { siteId } = req.params;
    const site = await fetchSiteById(siteId);
    
    if (!site) {
      return res.status(404).json({ error: 'Site not found' });
    }
    
    const devices = await fetchSiteDevices(siteId);
    const alerts = await fetchAlerts(siteId, true); // unresolved only
    const latestReport = await fetchWeeklyReports(siteId, 1);
    
    // Get battery status for all devices
    const devicesBatteryStatus = await Promise.all(devices.map(async (device) => {
      const telemetry = await fetchTelemetry(device.device_id);
      const config = await getBatteryConfig(device.device_id);
      const latestData = telemetry[0];
      
      const batteryPercentage = latestData?.battery_voltage ? 
        calculateBatteryPercentage(latestData.battery_voltage, config) : null;
      
      return {
        device_id: device.device_id,
        device_type: device.device_type,
        status: device.status,
        last_seen: device.last_seen,
        battery_voltage: latestData?.battery_voltage,
        battery_percentage: batteryPercentage,
        battery_status: isBatteryCritical(latestData?.battery_voltage, config) ? 'critical' :
                       isBatteryWarning(latestData?.battery_voltage, config) ? 'warning' : 'ok',
        pv_voltage: latestData?.pv_voltage,
        temperature: latestData?.temperature,
        current: latestData?.current
      };
    }));
    
    const siteHealth = {
      site_id: site.site_id,
      site_name: site.site_name,
      oem: site.oem,
      status: site.status,
      capacity_kw: site.capacity_kw,
      location: site.location,
      devices: {
        total: devices.length,
        online: devices.filter(d => d.status === 'online').length,
        details: devicesBatteryStatus
      },
      alerts: {
        active_count: alerts.length,
        details: alerts.slice(0, 10) // Last 10 alerts
      },
      latest_report: latestReport[0] || null,
      last_update: new Date().toISOString()
    };
    
    res.json(siteHealth);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger weekly report generation for a site
app.post("/api/sites/:siteId/reports/weekly/generate", authenticateApiKey, async (req, res) => {
  try {
    const { siteId } = req.params;
    const weekStart = req.body.week_start ? new Date(req.body.week_start) : new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Start of current week
    
    const report = await generateWeeklyReport(siteId, weekStart);
    await logAuditEvent(req.user.userId, 'GENERATE_WEEKLY_REPORT', siteId, { week_start: weekStart });
    
    res.json({ status: 'ok', report });
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