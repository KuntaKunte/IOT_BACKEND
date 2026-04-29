# IoT Backend - Production Deployment Guide

## Overview
This guide covers deploying the IoT Backend system in production with enterprise-grade features including authentication, secure MQTT, horizontal scaling, and data pipelines.

## Production Features Implemented

### 1. Device Authentication & Security

#### Device Tokens
- Devices authenticate using secure tokens (90-day expiration)
- Endpoint: `POST /api/auth/device-tokens`
```bash
curl -X POST http://localhost:3000/api/auth/device-tokens \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"deviceId": "SW-1001"}'
```

#### API Keys
- User authentication via X-API-Key header
- 365-day expiration by default
- Endpoint: `POST /api/auth/keys`
```bash
curl -X POST http://localhost:3000/api/auth/keys \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"description": "Production API Key"}'
```

#### Audit Logging
- All authentication and command actions are logged
- Tracks user ID, action type, resource ID, and timestamp
- Enables forensic analysis and compliance reporting

### 2. Device Health Monitoring

#### Device Health Endpoint
- Real-time device status and anomaly detection
- Endpoint: `GET /api/devices/:deviceId/health`
```bash
curl http://localhost:3000/api/devices/SW-1001/health
```

Response includes:
- Device status (healthy/warning)
- Last reading timestamp
- Anomaly count
- Error count
- Latest telemetry data

#### Anomaly Detection
- Temperature > 50°C warning
- Battery voltage < 18V alert
- Endpoint: `GET /api/devices/:deviceId/alerts`

### 3. Data Pipelines & Analytics

#### Hourly Aggregation
- Automatic hourly telemetry aggregation for efficient querying
- Stores averages, record counts, and statistical summaries
- Endpoint: `POST /api/analytics/aggregate`
```bash
curl -X POST http://localhost:3000/api/analytics/aggregate \
  -H "X-API-Key: YOUR_API_KEY"
```

#### Historical Telemetry
- Query telemetry by date range
- Endpoint: `GET /api/devices/:deviceId/telemetry/range?startDate=2026-03-01&endDate=2026-03-16`

#### Device Analytics
- Summary statistics per device
- Endpoint: `GET /api/analytics/devices`

### 4. System Health Monitoring

#### System Endpoint
- Overall system health status
- Endpoint: `GET /api/system/health` (requires authentication)
```bash
curl http://localhost:3000/api/system/health \
  -H "X-API-Key: YOUR_API_KEY"
```

## Deployment Architecture

### Horizontal Scaling

#### Load Balancing
Deploy multiple API instances behind a load balancer (Nginx, HAProxy, or cloud provider):

```yaml
# nginx.conf example
upstream api_backend {
    least_conn;
    server api1:3000;
    server api2:3000;
    server api3:3000;
}

server {
    listen 80;
    location /api {
        proxy_pass http://api_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

#### Kubernetes Deployment
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: iot-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: iot-api
  template:
    metadata:
      labels:
        app: iot-api
    spec:
      containers:
      - name: api
        image: iot_backend_docker-node-api:latest
        ports:
        - containerPort: 3000
        env:
        - name: DB_URL
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: url
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

### Secure MQTT (TLS)

#### Enable TLS in Mosquitto
Update `mosquitto.conf`:

```conf
# Default listener with authentication
listener 1883
protocol mqtt

# Secure MQTT listener
listener 8883
protocol mqtt
cafile /mosquitto/config/ca.crt
certfile /mosquitto/config/server.crt
keyfile /mosquitto/config/server.key
require_certificate true
allow_anonymous false

# Password file (bcrypt hashes)
password_file /mosquitto/config/passwords.txt
```

#### Generate Certificates
```bash
# CA certificate
openssl genrsa -out ca.key 4096
openssl req -new -x509 -days 3650 -key ca.key -out ca.crt

# Server certificate
openssl genrsa -out server.key 4096
openssl req -new -key server.key -out server.csr
openssl x509 -req -days 365 -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt

# Client certificate
openssl genrsa -out client.key 4096
openssl req -new -key client.key -out client.csr
openssl x509 -req -days 365 -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out client.crt
```

#### Update ingestion.js for TLS
```javascript
const client = mqtt.connect('mqtts://mosquitto:8883', {
  key: fs.readFileSync('/certs/client.key'),
  cert: fs.readFileSync('/certs/client.crt'),
  ca: fs.readFileSync('/certs/ca.crt'),
  rejectUnauthorized: true,
  username: 'iot_user',
  password: 'secure_password'
});
```

### Message Queues (Kafka for High-Volume Scenarios)

#### Docker Compose Extension
```yaml
kafka:
  image: confluentinc/cp-kafka:latest
  environment:
    KAFKA_BROKER_ID: 1
    KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
    KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
  depends_on:
    - zookeeper

zookeeper:
  image: confluentinc/cp-zookeeper:latest
  environment:
    ZOOKEEPER_CLIENT_PORT: 2181
```

#### Producer Setup (Node.js)
```javascript
const { Kafka } = require('kafkajs');

const kafka = new Kafka({
  clientId: 'iot-app',
  brokers: ['kafka:9092']
});

const producer = kafka.producer();

// Send telemetry to Kafka
export async function publishTelemetry(deviceId, data) {
  await producer.send({
    topic: 'telemetry',
    messages: [
      {
        key: deviceId,
        value: JSON.stringify({
          device_id: deviceId,
          ...data,
          timestamp: new Date().toISOString()
        })
      }
    ]
  });
}
```

#### Consumer Setup (Data Pipeline)
```javascript
const consumer = kafka.consumer({ groupId: 'analytics-group' });

await consumer.subscribe({ topic: 'telemetry' });

await consumer.run({
  eachMessage: async ({ topic, partition, message }) => {
    const data = JSON.parse(message.value.toString());
    
    // Store in data warehouse
    await storeToDataWarehouse(data);
    
    // Trigger anomaly detection
    await checkAnomalies(data);
    
    // Update real-time dashboard
    await publishToWebSocket(data);
  }
});
```

## Database Optimization

### Index Strategy
All tables have indexes on frequently queried columns:
- `idx_telemetry_device_ts` - Device telemetry queries
- `idx_commands_device_created` - Command history
- `idx_device_tokens_token` - Token validation
- `idx_audit_logs_user` - Audit trail lookups

### Connection Pooling
```javascript
// Recommended for production: 20-50 connections
const pool = new Pool({
  connectionString: process.env.DB_URL,
  max: 30,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

### Archival Strategy
```sql
-- Archive old telemetry to separate table monthly
INSERT INTO telemetry_archive_2026_03
SELECT * FROM telemetry
WHERE ts < '2026-03-01'::timestamp;

DELETE FROM telemetry
WHERE ts < '2026-03-01'::timestamp;
```

## Monitoring & Observability

### Metrics Collection
Recommended: Prometheus + Grafana

```javascript
// Add to api.js
import client from 'prom-client';

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_ms',
  help: 'Duration of HTTP requests in ms',
  buckets: [0.1, 5, 15, 50, 100],
  labelNames: ['method', 'route', 'status_code']
});

// Middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    httpRequestDuration
      .labels(req.method, req.route?.path, res.statusCode)
      .observe(duration);
  });
  next();
});

// Export metrics
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});
```

### Logging Stack
```yaml
# Using ELK stack (Elasticsearch, Logstash, Kibana)
version: '3.8'
services:
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:latest
    environment:
      - discovery.type=single-node
  
  logstash:
    image: docker.elastic.co/logstash/logstash:latest
    volumes:
      - ./logstash.conf:/usr/share/logstash/pipeline/logstash.conf
  
  kibana:
    image: docker.elastic.co/kibana/kibana:latest
    ports:
      - "5601:5601"
```

### Alerting
```yaml
# Prometheus alerting rules
groups:
  - name: iot_alerts
    rules:
      - alert: HighDeviceTemperature
        expr: device_temperature > 50
        for: 5m
        annotations:
          summary: "Device {{ $labels.device_id }} temperature high"
      
      - alert: APIHighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
        annotations:
          summary: "API error rate above 5%"
```

## Security Best Practices

1. **API Key Rotation**
   - Change API keys every 90 days
   - Keep old keys for 30 days during transition
   - Revoke compromised keys immediately

2. **VPC Isolation**
   - Deploy databases in private subnets
   - Use VPN or bastion hosts for access
   - Enable security groups/NACLs

3. **Encryption at Rest**
   - Enable PostgreSQL encryption
   - Use encrypted storage for certificates

4. **Encryption in Transit**
   - TLS for all MQTT connections
   - HTTPS for all API calls
   - SSH for administrative access

5. **Rate Limiting**
   ```javascript
   import rateLimit from 'express-rate-limit';
   
   const apiLimiter = rateLimit({
     windowMs: 15 * 60 * 1000, // 15 minutes
     max: 1000, // limit each IP to 1000 requests per windowMs
     skip: (req) => req.headers['x-api-key'] // Skip for authenticated
   });
   
   app.use('/api/', apiLimiter);
   ```

## Backup & Recovery

### PostgreSQL Backups
```bash
# Daily backup
0 2 * * * pg_dump -U iot -d iotdb | gzip > /backups/iot_$(date +\%Y\%m\%d).sql.gz

# Recovery
gunzip < /backups/iot_20260316.sql.gz | psql -U iot -d iotdb
```

### Data Retention Policy
- Real-time data: 30 days in hot storage
- Aggregated data: 2 years
- Archive old data to cold storage (S3 Glacier)

## Performance Tuning

### Query Optimization
```sql
-- Add partial indexes for active devices
CREATE INDEX idx_telemetry_active ON telemetry(device_id, ts DESC)
WHERE device_id IN (SELECT device_id FROM devices WHERE status = 'online');

-- Analyze query plans
EXPLAIN ANALYZE
SELECT AVG(temperature) FROM telemetry
WHERE device_id = 'SW-1001' AND ts > NOW() - INTERVAL '7 days';
```

### Connection Pooling
- Use PgBouncer for connection pooling
- Set max connections to 20-30 per API instance
- Configure timeout values appropriately

## Scaling Checklist

- [ ] Enable HTTPS/TLS for all connections
- [ ] Configure API key authentication
- [ ] Set up load balancer with health checks
- [ ] Deploy 3+ API instances behind load balancer
- [ ] Configure secure MQTT with TLS
- [ ] Set up Kafka for high-volume scenarios
- [ ] Enable database connection pooling
- [ ] Configure Prometheus/Grafana monitoring
- [ ] Set up ELK stack for logging
- [ ] Implement automated backups
- [ ] Configure alert thresholds
- [ ] Test failover and recovery procedures
- [ ] Perform load testing (target: 1000 RPS per instance)

## Support & Maintenance

- **Response Time SLA**: < 100ms (p95)
- **Availability Target**: 99.9% uptime
- **Recovery Time Objective (RTO)**: < 5 minutes
- **Recovery Point Objective (RPO)**: < 1 minute

