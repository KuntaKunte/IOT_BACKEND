// Import Express framework for building the web server
import express from "express";
// Import Pool from pg library for PostgreSQL database connections
import { Pool } from "pg";

// Create an Express application instance
const app = express();

// Middleware to parse incoming JSON requests
app.use(express.json());

// Use CommonJS DB helper for query logic (keeps DB logic testable)
import { fetchTelemetry } from './db.js';

// Define a GET endpoint to retrieve telemetry data for a specific device
app.get("/api/telemetry/:deviceId", async (req, res) => {
  // Extract deviceId from the URL parameters
  const { deviceId } = req.params;
  // Query the database for the latest 100 telemetry records for the device, ordered by timestamp descending
  const rows = await fetchTelemetry(deviceId);
  // Send the query results as JSON response
  res.json(rows);
});

let server;

// Start the server on port 3000 when not running tests
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(3000, () => console.log('API running on port 3000'));
}

// Graceful shutdown for the API server
async function shutdownApi() {
  if (server) {
    await new Promise(resolve => server.close(resolve));
    console.log('API server closed');
  }
}

process.on('SIGINT', shutdownApi);
process.on('SIGTERM', shutdownApi);

export default app;