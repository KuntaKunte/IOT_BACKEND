// This file will be replaced by ESM tests that mock './db.js'
const request = require('supertest');

const createApp = require('../test/app.cjs');

test('GET /api/telemetry/:deviceId returns rows via adapter', async () => {
  const mockFetchTelemetry = jest.fn().mockResolvedValue([
    { device_id: 'dev1', ts: '2026-02-21T00:00:00Z', value: 42 },
  ]);

  const app = createApp(mockFetchTelemetry);

  const res = await request(app).get('/api/telemetry/dev1');

  expect(res.status).toBe(200);
  expect(res.body).toEqual([
    { device_id: 'dev1', ts: '2026-02-21T00:00:00Z', value: 42 },
  ]);
  expect(mockFetchTelemetry).toHaveBeenCalledWith('dev1');
});
