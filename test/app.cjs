const express = require('express');

module.exports = function createApp(fetchTelemetry) {
  const app = express();
  app.use(express.json());

  app.get('/api/telemetry/:deviceId', async (req, res) => {
    const { deviceId } = req.params;
    const rows = await fetchTelemetry(deviceId);
    res.json(rows);
  });

  return app;
};
