import { Pool } from 'pg';

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

// Device authentication - generate and validate API tokens
export async function createDeviceToken(deviceId, expiresIn = '90d') {
  const token = require('crypto').randomBytes(32).toString('hex');
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
export async function createApiKey(userId, description, expiresIn = '365d') {
  const key = require('crypto').randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 365 days
  
  const result = await pool.query(
    'INSERT INTO api_keys (user_id, api_key, description, expires_at, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
    [userId, key, description, expiresAt]
  );
  return result.rows[0];
}

export async function validateApiKey(apiKey) {
  const result = await pool.query(
    'SELECT * FROM api_keys WHERE api_key = $1 AND expires_at > NOW() AND is_active = true',
    [apiKey]
  );
  return result.rows[0];
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

export { pool };
