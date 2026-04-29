CREATE TABLE IF NOT EXISTS telemetry (
  id SERIAL PRIMARY KEY,
  device_id TEXT NOT NULL,
  pv_voltage REAL,
  battery_voltage REAL,
  current REAL,
  temperature REAL,
  ts TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  status TEXT DEFAULT 'offline',
  last_seen TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commands (
  id SERIAL PRIMARY KEY,
  device_id TEXT NOT NULL,
  command TEXT NOT NULL,
  parameters JSONB,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(),
  executed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS device_errors (
  id SERIAL PRIMARY KEY,
  device_id TEXT NOT NULL,
  error_type TEXT,
  error_message TEXT,
  ts TIMESTAMP DEFAULT NOW()
);

-- Production-grade features: Authentication and security
CREATE TABLE IF NOT EXISTS device_tokens (
  id SERIAL PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  last_used TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  api_key TEXT UNIQUE NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  last_used TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_id TEXT,
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Data pipelines: Aggregated data for efficient querying
CREATE TABLE IF NOT EXISTS telemetry_hourly (
  id SERIAL PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  hour TIMESTAMP NOT NULL,
  avg_pv_voltage REAL,
  avg_battery_voltage REAL,
  avg_current REAL,
  avg_temperature REAL,
  record_count INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(device_id, hour)
);

-- Alerts for anomaly detection
CREATE TABLE IF NOT EXISTS device_alerts (
  id SERIAL PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  severity TEXT DEFAULT 'warning',
  message TEXT,
  is_resolved BOOLEAN DEFAULT false,
  detected_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_telemetry_device_ts ON telemetry(device_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_commands_device_created ON commands(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_tokens_token ON device_tokens(token);
CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(api_key);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_hourly_device ON telemetry_hourly(device_id, hour DESC);
CREATE INDEX IF NOT EXISTS idx_device_alerts_device ON device_alerts(device_id, detected_at DESC);
