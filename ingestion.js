// Load environment variables from .env file
import "dotenv/config";
import { connect } from 'mqtt';
import { 
  pool, 
  upsertDevice, 
  insertError, 
  updateCommandStatus, 
  fetchPendingCommands, 
  createAlert, 
  updateSiteStatus, 
  updateDeviceSite,
  upsertSite,
  getBatteryConfig,
  isBatteryCritical,
  checkOfflineSites,
  hasActiveOfflineAlert,
  hasActiveBatteryCriticalAlert,
  fetchSiteById
} from './db.js';
import { sendAlertNotification, loadAlertSubscribers } from './alertNotificationService.js';

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

  // Load alert subscribers from database
  await loadAlertSubscribers(pool);

  // Refresh subscriber list periodically in case new subscribers are added
  setInterval(async () => {
    try {
      await loadAlertSubscribers(pool);
    } catch (err) {
      console.error('Error refreshing alert subscribers:', err);
    }
  }, 300000); // every 5 minutes

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

  // Periodic check for site offline alerts (every 1 minute)
  setInterval(async () => {
    try {
      // Check for sites offline (no data for 1 minute)
      const offlineSites = await checkOfflineSites(1);
      
      for (const site of offlineSites) {
        const hasAlert = await hasActiveOfflineAlert(site.site_id);
        
        if (!hasAlert) {
          // Create alert in database
          const alertData = await createAlert(
            null,
            site.site_id,
            'site_offline',
            'critical',
            `Site offline - no data received for over 60 minutes`
          );
          
          // Update site status
          await updateSiteStatus(site.site_id, 'offline');
          
          // Send notification
          await sendAlertNotification('site_offline', 'critical', {
            site_id: site.site_id,
            site_name: site.site_name,
            oem: site.oem,
            message: `Site "${site.site_name}" is offline - no telemetry received since ${site.last_seen || 'never'}`,
            alert_id: alertData.id
          });
          
          console.log('Created site offline alert for:', site.site_name);
        }
      }
      
      // Update device status for any device that has not been seen in the last 2 minutes
      await pool.query(`
        UPDATE devices
        SET status = 'offline'
        WHERE last_seen < NOW() - INTERVAL '2 minutes'
          AND status <> 'offline'
      `);

      // Update site status based on device status and last_seen timestamps
      await pool.query(`
        UPDATE sites s
        SET status = summary.new_status,
            last_seen = summary.last_seen,
            updated_at = NOW()
        FROM (
          SELECT
            site_id,
            CASE
              WHEN COUNT(CASE WHEN status = 'online' AND last_seen > NOW() - INTERVAL '2 minutes' THEN 1 END) > 0 THEN 'ok'
              WHEN COUNT(CASE WHEN status = 'online' THEN 1 END) > 0 THEN 'warning'
              ELSE 'offline'
            END AS new_status,
            MAX(last_seen) AS last_seen
          FROM devices
          GROUP BY site_id
        ) AS summary
        WHERE summary.site_id = s.site_id
      `);
    } catch (err) {
      console.error('Error checking site status:', err);
    }
  }, 60000); // Check every 1 minute

  client.on('message', async (topic, message) => {
    try {
      const parts = topic.split('/');
      const deviceId = parts[1];
      const messageType = parts[2];
      const data = JSON.parse(message.toString());

      if (messageType === 'telemetry') {
        // Ensure site and device associations are persisted from simulator payload
        if (data.site_id && data.site_name && data.oem) {
          await upsertSite(data.site_id, data.site_name, data.oem);
          await updateDeviceSite(deviceId, data.site_id, data.oem);
        }

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

        // Update device status and site status immediately
        await upsertDevice(deviceId, 'online');
        if (data.site_id) {
          await updateSiteStatus(data.site_id, 'ok');
        }
        
        // Check for battery critical alert using improved battery logic
        if (data.battery_voltage) {
          const deviceInfo = await pool.query(
            'SELECT site_id, oem FROM devices WHERE device_id = $1',
            [deviceId]
          );
          
          if (deviceInfo.rows[0]?.site_id) {
            const siteId = deviceInfo.rows[0].site_id;
            const batteryConfig = await getBatteryConfig(deviceId);
            
            // Check if battery is critical
            if (isBatteryCritical(data.battery_voltage, batteryConfig)) {
              const hasAlert = await hasActiveBatteryCriticalAlert(deviceId);
              
              if (!hasAlert) {
                const site = await fetchSiteById(siteId);
                const batteryPercentage = Math.round(((data.battery_voltage - batteryConfig.min_voltage) / (batteryConfig.max_voltage - batteryConfig.min_voltage)) * 100);
                
                const alertData = await createAlert(
                  deviceId,
                  siteId,
                  'battery_critical',
                  'critical',
                  `Battery critical: ${batteryPercentage}% (${data.battery_voltage}V)`
                );
                
                // Send notification
                await sendAlertNotification('battery_critical', 'critical', {
                  site_id: siteId,
                  site_name: site?.site_name,
                  device_id: deviceId,
                  oem: deviceInfo.rows[0].oem,
                  message: `Battery at critical level: ${batteryPercentage}% (${data.battery_voltage}V) - Action required`,
                  alert_id: alertData.id
                });
                
                console.log('Created battery critical alert for device:', deviceId, `(${batteryPercentage}%)`);
              }
            }
          }
        }

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
