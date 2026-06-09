import { Pool } from 'pg';
import crypto from 'crypto';

const pool = new Pool({ connectionString: process.env.DB_URL });

export async function fetchTelemetry(deviceId) {
  const result = await pool.query(
    'SELECT * FROM telemetry WHERE device_id=$1 ORDER BY ts DESC LIMIT 100',
    [deviceId]
  );
  return result.rows;
}

export async function upsertDevice(deviceId, status = 'online') {
  await pool.query(
    `INSERT INTO devices (device_id, status, last_seen)
     VALUES ($1, $2, NOW())
     ON CONFLICT (device_id)
     DO UPDATE SET status = $2, last_seen = NOW()`,
    [deviceId, status]
  );
}

export async function fetchDevices() {
  const result = await pool.query('SELECT * FROM devices ORDER BY last_seen DESC');
  return result.rows;
}

export async function insertCommand(deviceId, command, parameters = {}) {
  const result = await pool.query(
    `INSERT INTO commands (device_id, command, parameters)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [deviceId, command, JSON.stringify(parameters)]
  );
  return result.rows[0].id;
}

export async function updateCommandStatus(id, status) {
  await pool.query(
    'UPDATE commands SET status = $1, executed_at = NOW() WHERE id = $2',
    [status, id]
  );
}

export async function deleteCommands(deviceId) {
  await pool.query('DELETE FROM commands WHERE device_id = $1', [deviceId]);
}

export async function fetchPendingCommands(deviceId) {
  const result = await pool.query(
    'SELECT * FROM commands WHERE device_id = $1 AND status = \'pending\' ORDER BY created_at ASC',
    [deviceId]
  );
  return result.rows;
}

export async function insertError(deviceId, errorType, errorMessage) {
  await pool.query(
    'INSERT INTO device_errors (device_id, error_type, error_message) VALUES ($1, $2, $3)',
    [deviceId, errorType, errorMessage]
  );
}

export async function fetchErrors(deviceId) {
  const result = await pool.query(
    'SELECT * FROM device_errors WHERE device_id = $1 ORDER BY ts DESC LIMIT 50',
    [deviceId]
  );
  return result.rows;
}

export async function fetchCommands(deviceId) {
  const result = await pool.query(
    'SELECT * FROM commands WHERE device_id = $1 ORDER BY created_at DESC LIMIT 100',
    [deviceId]
  );
  return result.rows;
}

export async function fetchTelemetryStats(deviceId, startDate, endDate) {
  let query = `
    SELECT
      COUNT(*) as total_records,
      AVG(pv_voltage) as avg_pv_voltage,
      MIN(pv_voltage) as min_pv_voltage,
      MAX(pv_voltage) as max_pv_voltage,
      AVG(battery_voltage) as avg_battery_voltage,
      MIN(battery_voltage) as min_battery_voltage,
      MAX(battery_voltage) as max_battery_voltage,
      AVG(current) as avg_current,
      MIN(current) as min_current,
      MAX(current) as max_current,
      AVG(temperature) as avg_temperature,
      MIN(temperature) as min_temperature,
      MAX(temperature) as max_temperature,
      MIN(ts) as first_record,
      MAX(ts) as last_record
    FROM telemetry
    WHERE device_id = $1
  `;
  
  const params = [deviceId];
  if (startDate && endDate) {
    query += ' AND ts >= $2 AND ts <= $3';
    params.push(startDate, endDate);
  }
  
  const result = await pool.query(query, params);
  return result.rows[0];
}

export async function fetchTelemetryByDateRange(deviceId, startDate, endDate, limit = 1000) {
  const result = await pool.query(
    'SELECT * FROM telemetry WHERE device_id = $1 AND ts >= $2 AND ts <= $3 ORDER BY ts DESC LIMIT $4',
    [deviceId, startDate, endDate, limit]
  );
  return result.rows.reverse(); // Return in chronological order
}

export async function fetchAllDevicesStats() {
  const query = `
    SELECT
      d.device_id,
      d.status,
      d.last_seen,
      COUNT(t.id) as total_records,
      AVG(t.pv_voltage) as avg_pv_voltage,
      AVG(t.battery_voltage) as avg_battery_voltage,
      AVG(t.current) as avg_current,
      AVG(t.temperature) as avg_temperature,
      MAX(t.ts) as last_record
    FROM devices d
    LEFT JOIN telemetry t ON d.device_id = t.device_id
    GROUP BY d.device_id, d.status, d.last_seen
    ORDER BY d.last_seen DESC
  `;
  const result = await pool.query(query);
  return result.rows;
}

function hashPassword(password, salt = null) {
  const saltValue = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, saltValue, 310000, 32, 'sha256').toString('hex');
  return { salt: saltValue, hash };
}

export async function getUsersCount() {
  const result = await pool.query('SELECT COUNT(*) as count FROM users');
  return parseInt(result.rows[0].count, 10);
}

export async function getUserByUsername(username) {
  const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  return result.rows[0];
}

export async function getUserById(userId) {
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
  return result.rows[0];
}

export async function createUser(username, password, roles = ['admin']) {
  const { salt, hash } = hashPassword(password);
  const result = await pool.query(
    'INSERT INTO users (username, password_hash, password_salt, roles) VALUES ($1, $2, $3, $4) RETURNING *',
    [username, hash, salt, roles]
  );
  return result.rows[0];
}

export async function verifyUserCredentials(username, password) {
  const user = await getUserByUsername(username);
  if (!user) return null;
  const { hash } = hashPassword(password, user.password_salt);
  return hash === user.password_hash ? user : null;
}

// Device authentication - generate and validate API tokens
export async function createDeviceToken(deviceId, expiresIn = '90d') {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days
  
  const result = await pool.query(
    'INSERT INTO device_tokens (device_id, token, expires_at) VALUES ($1, $2, $3) RETURNING *',
    [deviceId, token, expiresAt]
  );
  return result.rows[0];
}

export async function validateDeviceToken(token) {
  const result = await pool.query(
    'SELECT * FROM device_tokens WHERE token = $1 AND expires_at > NOW()',
    [token]
  );
  return result.rows[0];
}

// Device authentication - user API keys
export async function createApiKey(userId, description, expiresInDays = 365) {
  const key = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
  
  const result = await pool.query(
    'INSERT INTO api_keys (user_id, api_key, description, expires_at, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
    [userId, key, description, expiresAt]
  );
  return result.rows[0];
}

export async function validateApiKey(apiKey) {
  const result = await pool.query(
    `SELECT ak.*, u.username, u.roles
     FROM api_keys ak
     JOIN users u ON ak.user_id = u.id
     WHERE ak.api_key = $1 AND ak.expires_at > NOW() AND ak.is_active = true`,
    [apiKey]
  );
  const keyRecord = result.rows[0];
  if (!keyRecord) return null;
  await pool.query('UPDATE api_keys SET last_used = NOW() WHERE id = $1', [keyRecord.id]);
  return keyRecord;
}

export async function revokeApiKey(apiKey) {
  await pool.query('UPDATE api_keys SET is_active = false WHERE api_key = $1', [apiKey]);
}

export async function createAccessToken(userId, expiresInMinutes = 15) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);
  const result = await pool.query(
    'INSERT INTO access_tokens (user_id, token, expires_at, revoked, created_at) VALUES ($1, $2, $3, false, NOW()) RETURNING *',
    [userId, token, expiresAt]
  );
  return result.rows[0];
}

export async function validateAccessToken(token) {
  const result = await pool.query(
    `SELECT at.*, u.username, u.roles
     FROM access_tokens at
     JOIN users u ON at.user_id = u.id
     WHERE at.token = $1 AND at.expires_at > NOW() AND at.revoked = false`,
    [token]
  );
  return result.rows[0];
}

export async function revokeAccessToken(token) {
  await pool.query('UPDATE access_tokens SET revoked = true WHERE token = $1', [token]);
}

export async function createRefreshToken(userId, expiresInDays = 30) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
  const result = await pool.query(
    'INSERT INTO refresh_tokens (user_id, token, expires_at, revoked, created_at) VALUES ($1, $2, $3, false, NOW()) RETURNING *',
    [userId, token, expiresAt]
  );
  return result.rows[0];
}

export async function validateRefreshToken(token) {
  const result = await pool.query(
    'SELECT * FROM refresh_tokens WHERE token = $1 AND expires_at > NOW() AND revoked = false',
    [token]
  );
  return result.rows[0];
}

export async function revokeRefreshToken(token) {
  await pool.query('UPDATE refresh_tokens SET revoked = true WHERE token = $1', [token]);
}

// Audit logging for security tracking
export async function logAuditEvent(userId, action, resourceId, details = {}) {
  const result = await pool.query(
    'INSERT INTO audit_logs (user_id, action, resource_id, details, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
    [userId, action, resourceId, JSON.stringify(details)]
  );
  return result.rows[0];
}

// Data pipeline - aggregate telemetry for analytics
export async function aggregateTelemetryHourly() {
  const result = await pool.query(`
    INSERT INTO telemetry_hourly (device_id, hour, avg_pv_voltage, avg_battery_voltage, avg_current, avg_temperature, record_count)
    SELECT 
      device_id,
      date_trunc('hour', ts) as hour,
      AVG(pv_voltage),
      AVG(battery_voltage),
      AVG(current),
      AVG(temperature),
      COUNT(*)
    FROM telemetry
    WHERE ts > NOW() - INTERVAL '1 hour' AND ts <= date_trunc('hour', NOW())
    GROUP BY device_id, hour
    ON CONFLICT (device_id, hour) DO UPDATE SET
      avg_pv_voltage = EXCLUDED.avg_pv_voltage,
      avg_battery_voltage = EXCLUDED.avg_battery_voltage,
      avg_current = EXCLUDED.avg_current,
      avg_temperature = EXCLUDED.avg_temperature,
      record_count = EXCLUDED.record_count
  `);
  return result.rows;
}

// Alert detection - identify anomalies
export async function checkDeviceAnomalies(deviceId) {
  const result = await pool.query(`
    SELECT 
      device_id,
      'temperature_high' as anomaly_type,
      MAX(temperature) as value,
      NOW() as detected_at
    FROM telemetry
    WHERE device_id = $1 AND ts > NOW() - INTERVAL '1 hour'
    GROUP BY device_id
    HAVING MAX(temperature) > 50
    UNION ALL
    SELECT
      device_id,
      'voltage_low' as anomaly_type,
      MIN(battery_voltage) as value,
      NOW() as detected_at
    FROM telemetry
    WHERE device_id = $1 AND ts > NOW() - INTERVAL '1 hour'
    GROUP BY device_id
    HAVING MIN(battery_voltage) < 18
  `, [deviceId]);
  return result.rows;
}

// ==================== Sites Management ====================

export async function upsertSite(siteId, siteName, oem, location = null, capacityKw = null) {
  await pool.query(
    `INSERT INTO sites (site_id, site_name, oem, location, capacity_kw, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (site_id)
     DO UPDATE SET site_name = $2, oem = $3, location = $4, capacity_kw = $5, updated_at = NOW()`,
    [siteId, siteName, oem, location, capacityKw]
  );
}

export async function updateSiteStatus(siteId, status) {
  await pool.query(
    `UPDATE sites SET status = $1, last_seen = NOW(), updated_at = NOW() WHERE site_id = $2`,
    [status, siteId]
  );
}

export async function fetchSites() {
  const result = await pool.query(`
    SELECT s.*, 
      COUNT(d.device_id) as device_count,
      MAX(d.last_seen) as last_device_seen
    FROM sites s
    LEFT JOIN devices d ON s.site_id = d.site_id
    GROUP BY s.id
    ORDER BY s.site_name
  `);
  return result.rows;
}

export async function fetchSiteById(siteId) {
  const result = await pool.query(`
    SELECT s.*, 
      COUNT(d.device_id) as device_count,
      MAX(d.last_seen) as last_device_seen
    FROM sites s
    LEFT JOIN devices d ON s.site_id = d.site_id
    WHERE s.site_id = $1
    GROUP BY s.id
  `, [siteId]);
  return result.rows[0];
}

export async function fetchSiteDevices(siteId) {
  const result = await pool.query(
    'SELECT * FROM devices WHERE site_id = $1 ORDER BY device_id',
    [siteId]
  );
  return result.rows;
}

// ==================== Alerts Management ====================

export async function createAlert(deviceId, siteId, alertType, severity, message) {
  const result = await pool.query(
    `INSERT INTO device_alerts (device_id, site_id, alert_type, severity, message)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [deviceId, siteId, alertType, severity, message]
  );
  return result.rows[0];
}

export async function fetchAlerts(siteId = null, unresolvedOnly = false) {
  let query = `
    SELECT a.*, s.site_name, d.device_id as device_id
    FROM device_alerts a
    LEFT JOIN sites s ON a.site_id = s.site_id
    LEFT JOIN devices d ON a.device_id = d.device_id
  `;
  const params = [];
  const conditions = [];
  
  if (siteId) {
    conditions.push(`a.site_id = $${params.length + 1}`);
    params.push(siteId);
  }
  
  if (unresolvedOnly) {
    conditions.push('a.is_resolved = false');
  }
  
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  
  query += ' ORDER BY a.detected_at DESC LIMIT 100';
  
  const result = await pool.query(query, params);
  return result.rows;
}

export async function resolveAlert(alertId) {
  await pool.query(
    `UPDATE device_alerts SET is_resolved = true, resolved_at = NOW() WHERE id = $1`,
    [alertId]
  );
}

export async function getActiveAlertsCount() {
  const result = await pool.query(
    `SELECT COUNT(*) as count FROM device_alerts WHERE is_resolved = false`
  );
  return parseInt(result.rows[0].count);
}

// ==================== Weekly Reports ====================

export async function generateWeeklyReport(siteId, weekStart) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  
  // Calculate uptime - percentage of devices online during the week
  const uptimeResult = await pool.query(`
    WITH device_hours AS (
      SELECT 
        d.device_id,
        COUNT(DISTINCT DATE(t.ts), EXTRACT(HOUR FROM t.ts)) as hours_with_data
      FROM devices d
      LEFT JOIN telemetry t ON d.device_id = t.device_id 
        AND t.ts >= $2 AND t.ts < $3
      WHERE d.site_id = $1
      GROUP BY d.device_id
    )
    SELECT 
      COUNT(DISTINCT device_id) as total_devices,
      COALESCE(AVG(CASE WHEN hours_with_data > 0 THEN 1 ELSE 0 END), 0) * 100 as uptime_percentage
    FROM device_hours
  `, [siteId, weekStart, weekEnd]);
  
  const uptimePercentage = parseFloat(uptimeResult.rows[0]?.uptime_percentage) || 0;
  
  // Energy produced - sum of power output from current readings
  // Assuming current is in Amps, convert to kWh by assuming average voltage of 24V
  // Energy (kWh) = Sum(Current * Time) / 1000, where time is in hours
  const energyResult = await pool.query(`
    SELECT 
      COALESCE(SUM(t.current * INTERVAL '1 second' / 3600 * 24 / 1000), 0) as total_energy_kwh
    FROM telemetry t
    JOIN devices d ON t.device_id = d.device_id
    WHERE d.site_id = $1 AND t.ts >= $2 AND t.ts < $3 AND t.current IS NOT NULL
  `, [siteId, weekStart, weekEnd]);
  
  const energyProduced = parseFloat(energyResult.rows[0]?.total_energy_kwh) || 0;
  
  // Battery issues count - all battery critical alerts in the week
  const batteryIssuesResult = await pool.query(`
    SELECT COUNT(*) as count
    FROM device_alerts a
    WHERE a.site_id = $1 AND a.alert_type = 'battery_critical'
      AND a.detected_at >= $2 AND a.detected_at < $3
  `, [siteId, weekStart, weekEnd]);
  
  const batteryIssuesCount = parseInt(batteryIssuesResult.rows[0]?.count || 0);
  
  // Device offline hours - calculate total hours devices were offline during the week
  const offlineHoursResult = await pool.query(`
    WITH device_telemetry_gaps AS (
      SELECT 
        d.device_id,
        COALESCE(MAX(t.ts), '2000-01-01'::timestamp) as last_telemetry,
        $3::timestamp as week_end
      FROM devices d
      LEFT JOIN telemetry t ON d.device_id = t.device_id AND t.ts >= $2 AND t.ts < $3
      WHERE d.site_id = $1
      GROUP BY d.device_id
    )
    SELECT 
      COALESCE(SUM(
        CASE 
          WHEN last_telemetry < week_end - INTERVAL '1 hour' THEN 24 * 7
          ELSE EXTRACT(EPOCH FROM (week_end - GREATEST(last_telemetry, $2::timestamp))) / 3600
        END
      ), 0) as offline_hours
    FROM device_telemetry_gaps
  `, [siteId, weekStart, weekEnd]);
  
  const offlineHours = parseFloat(offlineHoursResult.rows[0]?.offline_hours) || 0;
  
  // All alerts triggered during the week
  const alertsResult = await pool.query(`
    SELECT COUNT(*) as count
    FROM device_alerts a
    WHERE a.site_id = $1 AND a.detected_at >= $2 AND a.detected_at < $3
  `, [siteId, weekStart, weekEnd]);
  
  const alertsTriggeredCount = parseInt(alertsResult.rows[0]?.count || 0);
  
  // Upsert the weekly report
  await pool.query(
    `INSERT INTO weekly_reports (site_id, report_week, uptime_percentage, energy_produced_kwh, battery_issues_count, device_offline_hours, alerts_triggered_count, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (site_id, report_week) DO UPDATE SET
       uptime_percentage = $3, 
       energy_produced_kwh = $4, 
       battery_issues_count = $5,
       device_offline_hours = $6, 
       alerts_triggered_count = $7,
       created_at = NOW()`,
    [
      siteId, 
      weekStart, 
      uptimePercentage, 
      energyProduced,
      batteryIssuesCount,
      offlineHours,
      alertsTriggeredCount
    ]
  );
  
  return {
    site_id: siteId,
    report_week: weekStart,
    uptime_percentage: uptimePercentage,
    energy_produced_kwh: energyProduced,
    battery_issues_count: batteryIssuesCount,
    device_offline_hours: offlineHours,
    alerts_triggered_count: alertsTriggeredCount
  };
}

export async function fetchWeeklyReports(siteId = null, weeks = 12) {
  let query = `
    SELECT wr.*, s.site_name, s.oem
    FROM weekly_reports wr
    JOIN sites s ON wr.site_id = s.site_id
  `;
  const params = [];
  
  if (siteId) {
    query += ` WHERE wr.site_id = $1`;
    params.push(siteId);
  }
  
  query += ` ORDER BY wr.report_week DESC LIMIT $${params.length + 1}`;
  params.push(weeks);
  
  const result = await pool.query(query, params);
  return result.rows;
}

// ==================== Dashboard Aggregations ====================

export async function fetchDashboardSummary() {
  // Get all sites with their status
  const sitesResult = await pool.query(`
    SELECT 
      s.site_id,
      s.site_name,
      s.oem,
      s.status,
      s.location,
      s.capacity_kw,
      s.last_seen,
      COUNT(d.device_id) as device_count,
      COUNT(CASE WHEN d.status = 'online' THEN 1 END) as online_devices
    FROM sites s
    LEFT JOIN devices d ON s.site_id = d.site_id
    GROUP BY s.id
    ORDER BY s.site_name
  `);
  
  // Get active alerts count
  const alertsResult = await pool.query(`
    SELECT COUNT(*) as count FROM device_alerts WHERE is_resolved = false
  `);
  
  // Get OEM distribution
  const oemResult = await pool.query(`
    SELECT oem, COUNT(*) as site_count
    FROM sites
    GROUP BY oem
  `);
  
  return {
    sites: sitesResult.rows,
    activeAlerts: parseInt(alertsResult.rows[0].count),
    oemDistribution: oemResult.rows
  };
}

export async function updateDeviceSite(deviceId, siteId, oem, model = null) {
  await pool.query(
    `INSERT INTO devices (device_id, site_id, oem, model, status, last_seen)
     VALUES ($1, $2, $3, $4, 'online', NOW())
     ON CONFLICT (device_id)
     DO UPDATE SET site_id = $2, oem = $3, model = $4, status = 'online', last_seen = NOW()`,
    [deviceId, siteId, oem, model]
  );
}

// ==================== Battery Management ====================

export async function getBatteryConfig(deviceId) {
  const result = await pool.query(
    `SELECT * FROM device_battery_config WHERE device_id = $1`,
    [deviceId]
  );
  return result.rows[0] || {
    device_id: deviceId,
    min_voltage: 18,
    max_voltage: 28.8,
    critical_percentage: 20,
    warning_percentage: 40
  };
}

export async function setBatteryConfig(deviceId, config) {
  await pool.query(
    `INSERT INTO device_battery_config (device_id, battery_type, battery_capacity_kwh, min_voltage, max_voltage, critical_percentage, warning_percentage, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (device_id)
     DO UPDATE SET battery_type = $2, battery_capacity_kwh = $3, min_voltage = $4, max_voltage = $5, critical_percentage = $6, warning_percentage = $7, updated_at = NOW()`,
    [deviceId, config.battery_type, config.battery_capacity_kwh, config.min_voltage, config.max_voltage, config.critical_percentage, config.warning_percentage]
  );
}

/**
 * Calculate battery percentage based on voltage
 * @param {number} voltage - Current battery voltage
 * @param {object} config - Battery configuration with min/max voltage
 * @returns {number} Battery percentage (0-100)
 */
export function calculateBatteryPercentage(voltage, config) {
  if (!voltage || !config) return null;
  
  const minVolt = config.min_voltage || 18;
  const maxVolt = config.max_voltage || 28.8;
  const percentage = ((voltage - minVolt) / (maxVolt - minVolt)) * 100;
  return Math.max(0, Math.min(100, percentage));
}

/**
 * Check if battery is in critical state
 * @param {number} voltage - Current battery voltage
 * @param {object} config - Battery configuration with critical_percentage
 * @returns {boolean} True if battery is critical
 */
export function isBatteryCritical(voltage, config) {
  if (!voltage || !config) return false;
  
  const percentage = calculateBatteryPercentage(voltage, config);
  return percentage <= (config.critical_percentage || 20);
}

/**
 * Check if battery is in warning state
 * @param {number} voltage - Current battery voltage
 * @param {object} config - Battery configuration with warning_percentage
 * @returns {boolean} True if battery is warning
 */
export function isBatteryWarning(voltage, config) {
  if (!voltage || !config) return false;
  
  const percentage = calculateBatteryPercentage(voltage, config);
  return percentage <= (config.warning_percentage || 40) && percentage > (config.critical_percentage || 20);
}

// ==================== Alert Subscribers ====================

export async function addAlertSubscriber(alertType, email) {
  await pool.query(
    `INSERT INTO alert_subscribers (alert_type, email, is_active)
     VALUES ($1, $2, true)
     ON CONFLICT (alert_type, email) DO UPDATE SET is_active = true`,
    [alertType, email]
  );
}

export async function removeAlertSubscriber(alertType, email) {
  await pool.query(
    `UPDATE alert_subscribers SET is_active = false WHERE alert_type = $1 AND email = $2`,
    [alertType, email]
  );
}

export async function getAlertSubscribers(alertType = null) {
  let query = `
    SELECT alert_type, email
    FROM alert_subscribers
    WHERE is_active = true
  `;
  const params = [];
  
  if (alertType) {
    query += ` AND (alert_type = $1 OR alert_type = 'all')`;
    params.push(alertType);
  }
  
  const result = await pool.query(query, params);
  return result.rows;
}

// ==================== Site Offline Detection ====================

/**
 * Check for sites that have been offline for a specified duration
 * @param {number} minutes - Minutes of inactivity to consider offline
 * @returns {Promise<Array>} Sites that are offline
 */
export async function checkOfflineSites(minutes = 60) {
  const result = await pool.query(`
    SELECT s.site_id, s.site_name, MAX(d.last_seen) as last_seen, s.oem
    FROM sites s
    LEFT JOIN devices d ON s.site_id = d.site_id
    GROUP BY s.site_id, s.site_name, s.oem
    HAVING MAX(d.last_seen) < NOW() - INTERVAL '1 minute' * $1 OR MAX(d.last_seen) IS NULL
  `, [minutes]);
  return result.rows;
}

/**
 * Check if a site has an active offline alert
 * @param {string} siteId - Site ID
 * @returns {Promise<boolean>} True if active alert exists
 */
export async function hasActiveOfflineAlert(siteId) {
  const result = await pool.query(`
    SELECT id FROM device_alerts 
    WHERE site_id = $1 AND alert_type = 'site_offline' AND is_resolved = false
    AND detected_at > NOW() - INTERVAL '1 hour'
    LIMIT 1
  `, [siteId]);
  return result.rows.length > 0;
}

/**
 * Check if a device has an active battery critical alert
 * @param {string} deviceId - Device ID
 * @returns {Promise<boolean>} True if active alert exists
 */
export async function hasActiveBatteryCriticalAlert(deviceId) {
  const result = await pool.query(`
    SELECT id FROM device_alerts 
    WHERE device_id = $1 AND alert_type = 'battery_critical' AND is_resolved = false
    AND detected_at > NOW() - INTERVAL '30 minutes'
    LIMIT 1
  `, [deviceId]);
  return result.rows.length > 0;
}

export { pool };
