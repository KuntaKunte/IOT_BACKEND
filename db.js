import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DB_URL });

export async function fetchTelemetry(deviceId) {
  const result = await pool.query(
    'SELECT * FROM telemetry WHERE device_id=$1 ORDER BY ts DESC LIMIT 100',
    [deviceId]
  );
  return result.rows;
}

export { pool };
