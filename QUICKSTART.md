# Quick Start Guide - New Features

## Installation & Setup

### 1. Install Dependencies
```bash
npm install
```

This installs the new dependencies:
- `nodemailer` - Email sending
- `node-fetch` - HTTP requests for webhooks

### 2. Initialize Database
Run the schema migrations to create new tables:

```bash
psql -h localhost -U your_user -d your_database < db/schema.sql
```

### 3. Configure Environment
Copy and configure the environment template:

```bash
cp .env.template .env
# Edit .env with your settings:
# - SMTP configuration for emails
# - Alert email recipients
# - Battery thresholds
# - Webhook URL (optional)
```

### 4. Start Services
```bash
# Terminal 1: Start ingestion service
npm run start:ingestion

# Terminal 2: Start API server
npm run start:api
```

---

## 5-Minute Setup - Email Alerts

### A. Set Up Gmail SMTP

1. Enable 2-factor authentication: https://myaccount.google.com/security
2. Create App Password: https://myaccount.google.com/apppasswords
3. Add to `.env`:
   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your-email@gmail.com
   SMTP_PASS=<16-char app password>
   ALERT_EMAIL_ALL=you@gmail.com
   ```

### B. Restart Services
```bash
# Restart both services to load new env vars
```

### C. Test Alert System
```bash
# Create a site (bash)
curl -X POST http://localhost:3000/api/sites \
  -H "Content-Type: application/json" \
  -d '{"site_id": "test_01", "site_name": "Test Site", "oem": "growatt"}'

# If using Windows PowerShell, do not use backslash line continuation.
# Use a single line or use Invoke-RestMethod instead.
Invoke-RestMethod -Method POST -Uri http://localhost:3000/api/sites -ContentType 'application/json' -Body '{"site_id":"test_01","site_name":"Test Site","oem":"growatt"}'

# Or with native curl.exe in PowerShell:
curl.exe -X POST http://localhost:3000/api/sites -H "Content-Type: application/json" --data-binary '{"site_id":"test_01","site_name":"Test Site","oem":"growatt"}'

# Create a device (bash)
curl -X POST http://localhost:3000/api/devices/test_device_01 \
  -H "Content-Type: application/json" \
  -d '{"site_id": "test_01", "oem": "growatt"}'

# Add subscriber (bash)
curl -X POST http://localhost:3000/api/alerts/subscribers \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"alert_type": "battery_critical", "email": "you@gmail.com"}'
```

---

## Dashboard & Monitoring

### View Dashboard
```bash
# Multi-OEM dashboard
curl http://localhost:3000/api/dashboard/multi-oem | jq

# Site health details
curl http://localhost:3000/api/sites/site_001/health | jq
```

### Check Alerts
```bash
# Active alert count
curl http://localhost:3000/api/alerts/count | jq

# All alerts
curl http://localhost:3000/api/alerts | jq
```

### Weekly Reports
```bash
# Generate report (requires API key)
curl -X POST http://localhost:3000/api/reports/weekly/generate \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"siteId": "site_001"}'

# Fetch reports
curl "http://localhost:3000/api/reports/weekly?siteId=site_001" | jq
```

---

## Key Endpoints Quick Reference

### Dashboard
- `GET /api/dashboard/multi-oem` - Multi-OEM dashboard summary
- `GET /api/sites/{siteId}/health` - Site health with device details

### Alerts
- `GET /api/alerts` - List alerts
- `GET /api/alerts/count` - Active alert count
- `POST /api/alerts/{alertId}/resolve` - Mark alert as resolved

### Battery Management
- `GET /api/devices/{deviceId}/battery-config` - Get battery config
- `POST /api/devices/{deviceId}/battery-config` - Set battery config

### Alert Subscribers
- `POST /api/alerts/subscribers` - Add subscriber
- `DELETE /api/alerts/subscribers` - Remove subscriber
- `GET /api/alerts/subscribers` - List subscribers

### Reports
- `POST /api/reports/weekly/generate` - Generate weekly report
- `GET /api/reports/weekly` - Fetch reports

---

## Common Tasks

### Add a New Solar Site
```bash
curl -X POST http://localhost:3000/api/sites \
  -H "Content-Type: application/json" \
  -d '{
    "site_id": "site_002",
    "site_name": "Solar Farm B",
    "oem": "solis",
    "location": "San Jose, CA",
    "capacity_kw": 75
  }'
```

### Configure Device Battery
```bash
curl -X POST http://localhost:3000/api/devices/device_001/battery-config \
  -H "Content-Type: application/json" \
  -d '{
    "battery_type": "lifepo4",
    "battery_capacity_kwh": 10,
    "min_voltage": 18,
    "max_voltage": 28.8,
    "critical_percentage": 20,
    "warning_percentage": 40
  }'
```

### Add Alert Subscriber
```bash
curl -X POST http://localhost:3000/api/alerts/subscribers \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"alert_type": "site_offline", "email": "ops@company.com"}'
```

### View Site Status
```bash
curl http://localhost:3000/api/dashboard/multi-oem | \
  jq '.sites[] | {site_name, status, health_status, device_online_percentage}'
```

---

## Troubleshooting

### Emails Not Sending?
1. Check SMTP credentials in `.env`
2. Verify email address in `ALERT_EMAIL_ALL`
3. Check Docker logs: `docker logs container_name`
4. Verify SMTP is not blocking the connection

### Battery Alerts Not Triggering?
1. Check device battery config: `GET /api/devices/{deviceId}/battery-config`
2. Verify battery voltage in telemetry data
3. Check if alert already exists: `GET /api/alerts`

### Dashboard Showing Offline?
1. Check device telemetry: `GET /api/telemetry/{deviceId}`
2. Verify MQTT connection in ingestion logs
3. Check device `last_seen` timestamp

---

## Performance Tips

1. **Weekly Reports**: Generate during off-peak hours
2. **Email Throttling**: Alerts only sent for new conditions (not repeated)
3. **Database**: Indexes automatically created for performance
4. **Webhooks**: Set reasonable timeouts (currently 5 seconds)

---

## Docker Compose Integration

The services are typically run in Docker:

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f api
docker-compose logs -f ingestion

# Restart a service
docker-compose restart api
```

---

## Next Steps

1. Configure email alerts for your team
2. Set up battery thresholds for each device
3. Add your solar sites to the dashboard
4. Monitor the dashboard regularly
5. Set up webhook integration with Slack or Teams (optional)
6. Customize alert recipients per site

For detailed API documentation, see [FEATURES_GUIDE.md](FEATURES_GUIDE.md)
