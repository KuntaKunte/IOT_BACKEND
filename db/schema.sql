CREATE TABLE IF NOT EXISTS telemetry (
  id SERIAL PRIMARY KEY,
  device_id TEXT NOT NULL,
  pv_voltage REAL,
  battery_voltage REAL,
  current REAL,
  temperature REAL,
  ts TIMESTAMP DEFAULT NOW()
);

-- Sites table: Represents physical locations with inverters
CREATE TABLE IF NOT EXISTS sites (
  id SERIAL PRIMARY KEY,
  site_id TEXT UNIQUE NOT NULL,
  site_name TEXT NOT NULL,
  oem TEXT NOT NULL,  -- OEM vendor: 'growatt', 'solis', 'sofar', 'huawei', etc.
  location TEXT,
  capacity_kw REAL,  -- Installed capacity in kW
  status TEXT DEFAULT 'offline',  -- 'ok', 'warning', 'offline'
  last_seen TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Devices table: Inverters linked to sites
CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  site_id TEXT REFERENCES sites(site_id) ON DELETE CASCADE,
  device_type TEXT DEFAULT 'inverter',  -- 'inverter', 'battery', 'meter'
  oem TEXT NOT NULL,  -- OEM vendor for this device
  model TEXT,  -- Device model
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

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  roles TEXT[] NOT NULL DEFAULT ARRAY['admin']::TEXT[],
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  api_key TEXT UNIQUE NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  last_used TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
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
  device_id TEXT REFERENCES devices(device_id) ON DELETE CASCADE,
  site_id TEXT REFERENCES sites(site_id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  severity TEXT DEFAULT 'warning',
  message TEXT,
  is_resolved BOOLEAN DEFAULT false,
  detected_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP
);

-- Sites table: Represents physical locations with inverters
-- Alert rules configuration
CREATE TABLE IF NOT EXISTS alert_rules (
  id SERIAL PRIMARY KEY,
  rule_name TEXT NOT NULL,
  alert_type TEXT NOT NULL,  -- 'site_offline', 'battery_critical', 'device_offline'
  condition_type TEXT NOT NULL,  -- 'threshold', 'timeout', 'status_change'
  threshold_value REAL,
  threshold_unit TEXT,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Weekly reports data
CREATE TABLE IF NOT EXISTS weekly_reports (
  id SERIAL PRIMARY KEY,
  site_id TEXT REFERENCES sites(site_id) ON DELETE CASCADE,
  report_week DATE NOT NULL,  -- Start date of the week
  uptime_percentage REAL,
  energy_produced_kwh REAL,
  battery_issues_count INTEGER,
  device_offline_hours REAL,
  alerts_triggered_count INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(site_id, report_week)
);

-- Alert Subscribers configuration
CREATE TABLE IF NOT EXISTS alert_subscribers (
  id SERIAL PRIMARY KEY,
  alert_type TEXT NOT NULL,  -- 'site_offline', 'battery_critical', 'all'
  email TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Device battery configuration for battery percentage calculation
CREATE TABLE IF NOT EXISTS device_battery_config (
  device_id TEXT PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
  battery_type TEXT,  -- 'lithium', 'lead-acid', 'lifepo4'
  battery_capacity_kwh REAL,  -- Battery capacity in kWh
  min_voltage REAL DEFAULT 18,  -- Minimum safe voltage (typically 20% for 24V system = 18V)
  max_voltage REAL DEFAULT 28.8,  -- Maximum voltage (typically 100% for 24V system = 28.8V)
  critical_percentage REAL DEFAULT 20,  -- Alert threshold as percentage
  warning_percentage REAL DEFAULT 40,  -- Warning threshold as percentage
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_telemetry_device_ts ON telemetry(device_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_commands_device_created ON commands(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_tokens_token ON device_tokens(token);
CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(api_key);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_hourly_device ON telemetry_hourly(device_id, hour DESC);
CREATE INDEX IF NOT EXISTS idx_device_alerts_device ON device_alerts(device_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_alerts_site ON device_alerts(site_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_sites_site_id ON sites(site_id);
CREATE INDEX IF NOT EXISTS idx_devices_site_id ON devices(site_id);
CREATE INDEX IF NOT EXISTS idx_weekly_reports_site_week ON weekly_reports(site_id, report_week DESC);
CREATE INDEX IF NOT EXISTS idx_alert_subscribers_type ON alert_subscribers(alert_type, is_active);
