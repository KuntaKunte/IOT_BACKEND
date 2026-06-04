# Multi-OEM IoT Dashboard with Alerts and Reporting - Feature Guide

## Overview

This guide explains the three main features that have been added to your IoT Backend:

1. **Multi-OEM Dashboard** - Unified dashboard showing status for multiple inverter OEMs
2. **Alert System** - Automated alerts for site offline and battery critical events
3. **Weekly Reports** - Comprehensive weekly performance reports per site

---

## Feature 1: Multi-OEM Integrated Dashboard

### Overview
A unified dashboard that aggregates data from multiple inverter OEM sites (Growatt, Solis, Sofar, Huawei, etc.) into a single interface with status indicators.

### Status Levels
- **OK (Green)**: All devices online and functioning normally within the last hour
- **Warning (Yellow)**: Some devices online or devices offline but not exceeding threshold
- **Offline (Red)**: No devices reporting data for over 60 minutes

### API Endpoints

#### Get Multi-OEM Dashboard Summary
```http
GET /api/dashboard/multi-oem
```

**Response:**
```json
{
  "timestamp": "2024-05-12T10:30:00Z",
  "sites": [
    {
      "site_id": "site_001",
      "site_name": "Solar Farm A",
      "oem": "growatt",
      "status": "ok",
      "capacity_kw": 50.0,
      "location": "Los Angeles, CA",
      "device_count": 2,
      "online_devices": 2,
      "health_status": "OK",
      "device_online_percentage": 100,
      "last_activity": "2024-05-12T10:25:00Z"
    },
    {
      "site_id": "site_002",
      "site_name": "Warehouse B",
      "oem": "solis",
      "status": "offline",
      "capacity_kw": 30.0,
      "health_status": "Offline",
      "device_online_percentage": 0,
      "last_activity": null
    }
  ],
  "summary": {
    "total_sites": 2,
    "online_sites": 1,
    "warning_sites": 0,
    "offline_sites": 1,
    "active_alerts": 1,
    "oem_distribution": [
      { "oem": "growatt", "site_count": 1 },
      { "oem": "solis", "site_count": 1 }
    ]
  }
}
```

#### Get Site Health Status with Details
```http
GET /api/sites/{siteId}/health
```

**Response includes:**
- Site information and status
- Device list with battery status (percentage, voltage, critical/warning/ok)
- Active alerts
- Latest weekly report

**Example device battery status:**
```json
{
  "device_id": "device_001",
  "device_type": "inverter",
  "status": "online",
  "battery_voltage": 25.4,
  "battery_percentage": 75,
  "battery_status": "ok",
  "pv_voltage": 380.5,
  "temperature": 32.5,
  "current": 15.2
}
```

### Site Management

#### Create/Update Site
```http
POST /api/sites
Content-Type: application/json

{
  "site_id": "site_003",
  "site_name": "New Solar Installation",
  "oem": "huawei",
  "location": "San Francisco, CA",
  "capacity_kw": 100.0
}
```

#### Get All Sites
```http
GET /api/sites
```

#### Get Devices for a Site
```http
GET /api/sites/{siteId}/devices
```

---

## Feature 2: Alert System

### Overview
The alert system automatically detects and notifies about critical events:

1. **Site Offline Alert** - When a site hasn't sent data for 60 minutes
2. **Battery Critical Alert** - When battery voltage drops below 20% (configurable)

### Alert Types and Thresholds

#### Site Offline Alert
- **Trigger**: No telemetry data for 60+ minutes
- **Severity**: Critical
- **Notification**: Email + Webhook + Database

#### Battery Critical Alert
- **Trigger**: Battery voltage below configurable percentage (default: 20%)
- **Severity**: Critical
- **Based on**: Battery configuration per device
- **Notification**: Email + Webhook + Database

### Battery Configuration

#### Get Battery Configuration
```http
GET /api/devices/{deviceId}/battery-config
```

**Response:**
```json
{
  "device_id": "device_001",
  "battery_type": "lifepo4",
  "battery_capacity_kwh": 10.0,
  "min_voltage": 18.0,
  "max_voltage": 28.8,
  "critical_percentage": 20,
  "warning_percentage": 40
}
```

#### Set Battery Configuration
```http
POST /api/devices/{deviceId}/battery-config
Content-Type: application/json

{
  "battery_type": "lifepo4",
  "battery_capacity_kwh": 10.0,
  "min_voltage": 18.0,
  "max_voltage": 28.8,
  "critical_percentage": 20,
  "warning_percentage": 40
}
```

### Alert Notification Configuration

#### Email Setup
Set the following environment variables:

```env
# SMTP Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=alerts@yourdomain.com

# Default recipients (all alerts)
ALERT_EMAIL_ALL=admin@yourdomain.com

# Specific alert type recipients
ALERT_EMAIL_OFFLINE=ops@yourdomain.com
ALERT_EMAIL_BATTERY=maintenance@yourdomain.com
```

#### Webhook Setup (Optional)
For integrations with Slack, Microsoft Teams, or custom services:

```env
WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
WEBHOOK_SECRET=your-webhook-secret
```

### Alert Subscribers API

#### Get Subscribers
```http
GET /api/alerts/subscribers
Headers:
  X-API-Key: your-api-key
```

#### Add Subscriber
```http
POST /api/alerts/subscribers
Headers:
  X-API-Key: your-api-key
Content-Type: application/json

{
  "alert_type": "battery_critical",
  "email": "ops@yourdomain.com"
}
```

Valid alert_type values: `"site_offline"`, `"battery_critical"`, `"all"`

#### Remove Subscriber
```http
DELETE /api/alerts/subscribers
Headers:
  X-API-Key: your-api-key
Content-Type: application/json

{
  "alert_type": "battery_critical",
  "email": "ops@yourdomain.com"
}
```

### View Alerts

#### Get All Alerts
```http
GET /api/alerts?siteId={siteId}&unresolved=true
```

#### Get Active Alert Count
```http
GET /api/alerts/count
```

#### Resolve Alert
```http
POST /api/alerts/{alertId}/resolve
```

---

## Feature 3: Weekly Reports

### Overview
Comprehensive weekly performance reports per site, including:

- **Uptime Percentage**: Based on device telemetry data availability
- **Energy Produced (kWh)**: Calculated from current readings over the week
- **Battery Issues**: Count of battery critical alerts triggered
- **Device Offline Hours**: Total hours devices were offline
- **Alerts Triggered**: Total number of alerts during the week

### Report Generation

#### Generate Report
```http
POST /api/reports/weekly/generate
Headers:
  X-API-Key: your-api-key
Content-Type: application/json

{
  "siteId": "site_001",
  "week_start": "2024-05-12T00:00:00Z"  // Optional, defaults to current week
}
```

**Response:**
```json
{
  "status": "ok",
  "report": {
    "site_id": "site_001",
    "report_week": "2024-05-12T00:00:00Z",
    "uptime_percentage": 98.5,
    "energy_produced_kwh": 850.25,
    "battery_issues_count": 2,
    "device_offline_hours": 3.5,
    "alerts_triggered_count": 2
  }
}
```

#### Fetch Reports
```http
GET /api/reports/weekly?siteId={siteId}&weeks=12
```

Returns the last N weeks of reports for a site or all sites.

### Report Metrics Explained

1. **Uptime Percentage**
   - Calculated as: (hours with data / total hours in week) × 100
   - Measured across all devices at the site
   - Range: 0-100%

2. **Energy Produced (kWh)**
   - Sum of power output: $\sum (\text{Current} \times \text{Voltage} \times \text{Time}) / 1000$
   - Default voltage assumed: 24V
   - Only includes valid current readings

3. **Battery Issues**
   - Count of "battery_critical" alerts triggered during the week
   - Helps identify reliability issues

4. **Device Offline Hours**
   - Sum of hours all devices were offline
   - Calculated from gaps in telemetry data
   - Used to identify connectivity issues

5. **Alerts Triggered**
   - Total count of all alerts (site offline + battery critical)
   - Indicator of site stability

---

## Integration Guide

### Step 1: Configure Environment Variables

Copy `.env.template` to `.env` and configure:

```bash
cp .env.template .env
# Edit .env with your settings
```

### Step 2: Set Up Email Notifications

For Gmail SMTP:
1. Enable 2-factor authentication on Gmail account
2. Generate an App Password: https://support.google.com/accounts/answer/185833
3. Add to `.env`:
   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your-email@gmail.com
   SMTP_PASS=<your-app-password>
   ```

### Step 3: Configure Alert Subscribers

Add email recipients via API:

```bash
curl -X POST http://localhost:3000/api/alerts/subscribers \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "alert_type": "site_offline",
    "email": "ops@yourdomain.com"
  }'
```

### Step 4: Set Battery Configuration for Devices

For each device, configure battery thresholds:

```bash
curl -X POST http://localhost:3000/api/devices/device_001/battery-config \
  -H "Content-Type: application/json" \
  -d '{
    "battery_type": "lifepo4",
    "battery_capacity_kwh": 10.0,
    "min_voltage": 18.0,
    "max_voltage": 28.8,
    "critical_percentage": 20,
    "warning_percentage": 40
  }'
```

### Step 5: Create Sites and Link Devices

```bash
curl -X POST http://localhost:3000/api/sites \
  -H "Content-Type: application/json" \
  -d '{
    "site_id": "site_001",
    "site_name": "Solar Farm A",
    "oem": "growatt",
    "location": "Los Angeles, CA",
    "capacity_kw": 50.0
  }'
```

### Step 6: Monitor Dashboard

Access the multi-OEM dashboard:

```bash
curl http://localhost:3000/api/dashboard/multi-oem
```

Or individual site health:

```bash
curl http://localhost:3000/api/sites/site_001/health
```

---

## Database Schema Updates

The following tables have been added/updated:

### alert_subscribers
Stores email subscribers for different alert types

### device_battery_config
Stores battery voltage range and percentage thresholds per device

### sites
Updated to track status (ok/warning/offline) and last_seen

### device_alerts
Stores all triggered alerts with resolution status

### weekly_reports
Stores generated weekly reports per site

---

## Monitoring & Troubleshooting

### Check Alert Status
```bash
curl http://localhost:3000/api/alerts/count
```

### View Unresolved Alerts
```bash
curl "http://localhost:3000/api/alerts?unresolved=true"
```

### Test Email Configuration
Send a test alert by creating a mock battery critical condition in the database:

```bash
psql -h localhost -U user -d iot_db -c "
INSERT INTO device_alerts (device_id, site_id, alert_type, severity, message)
VALUES ('test_device', 'test_site', 'battery_critical', 'critical', 'Test alert')
"
```

### Monitor Ingestion Service Logs
```bash
docker logs -f iot_backend_ingestion_1
```

---

## Performance Considerations

1. **Alert Checking**: Site offline check runs every 5 minutes
2. **Weekly Reports**: Can be auto-generated or triggered manually
3. **Database Indexes**: Automatically created on alert and telemetry tables
4. **Email Rate Limiting**: Only sends alerts for new conditions (not repeated)

---

## API Authentication

Most endpoints are public, but the following require API key:

- POST /api/alerts/subscribers (add subscriber)
- DELETE /api/alerts/subscribers (remove subscriber)
- POST /api/reports/weekly/generate (generate report)
- POST /api/auth/keys (create API key)
- POST /api/auth/device-tokens (create device token)

Use header: `X-API-Key: your-api-key`

---

## Future Enhancements

1. Custom alert rules engine
2. Predictive alerts based on trends
3. Multi-language email templates
4. SMS notifications
5. Real-time dashboard notifications
6. Data export (PDF reports)
7. Custom metrics and KPIs
