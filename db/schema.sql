CREATE TABLE IF NOT EXISTS telemetry (
  id SERIAL PRIMARY KEY,
  device_id TEXT NOT NULL,
  pv_voltage REAL,
  battery_voltage REAL,
  current REAL,
  temperature REAL,
  ts TIMESTAMP DEFAULT NOW()
);
