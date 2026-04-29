import { useState, useEffect } from 'react'
import axios from 'axios'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import './index.css'

function App() {
  const [devices, setDevices] = useState([])
  const [selectedDevice, setSelectedDevice] = useState('')
  const [telemetry, setTelemetry] = useState([])
  const [command, setCommand] = useState('')
  const [parameters, setParameters] = useState('{}')
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [commandHistory, setCommandHistory] = useState([])
  const [template, setTemplate] = useState('')
  const [analytics, setAnalytics] = useState(null)
  const [allDevicesStats, setAllDevicesStats] = useState([])
  const [dateRangeTelemetry, setDateRangeTelemetry] = useState([])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [bulkDevices, setBulkDevices] = useState([])
  const [bulkCommand, setBulkCommand] = useState('')
  const [bulkParameters, setBulkParameters] = useState('{}')

  const templates = [
    { value: '', label: '— none —', command: '', parameters: '{}' },
    { value: 'restart', label: 'Restart', command: 'restart', parameters: '{}' },
    {
      value: 'update_firmware',
      label: 'Update Firmware',
      command: 'update_firmware',
      parameters: JSON.stringify({ version: '1.0.0' }, null, 2)
    },
    {
      value: 'set_parameter',
      label: 'Set Parameter',
      command: 'set_parameter',
      parameters: JSON.stringify({ param: 'name', value: 'value' }, null, 2)
    }
  ]


  useEffect(() => {
    fetchDevices()
    fetchAllDevicesStats()
  }, [])

  const fetchDevices = async () => {
    try {
      const response = await axios.get('/api/devices')
      setDevices(response.data)
      if (response.data.length > 0 && !selectedDevice) {
        setSelectedDevice(response.data[0].device_id)
      }
    } catch (error) {
      console.error('Error fetching devices:', error)
    }
  }

  const fetchTelemetry = async (deviceId) => {
    if (!deviceId) return
    try {
      const response = await axios.get(`/api/telemetry/${deviceId}`)
      setTelemetry(response.data.reverse()) // Reverse to show oldest first
      setErrorMessage('')
    } catch (error) {
      console.error('Error fetching telemetry:', error)
      setErrorMessage('Failed to load telemetry. See console for details.')
    }
  }

  const fetchCommandHistory = async (deviceId) => {
    if (!deviceId) return
    try {
      const response = await axios.get(`/api/devices/${deviceId}/commands`)
      setCommandHistory(response.data)
    } catch (error) {
      console.error('Error fetching command history:', error)
    }
  }

  const fetchAnalytics = async (deviceId) => {
    if (!deviceId) return
    try {
      const response = await axios.get(`/api/devices/${deviceId}/analytics`)
      setAnalytics(response.data)
    } catch (error) {
      console.error('Error fetching analytics:', error)
    }
  }

  const fetchAllDevicesStats = async () => {
    try {
      const response = await axios.get('/api/analytics/devices')
      setAllDevicesStats(response.data)
    } catch (error) {
      console.error('Error fetching all devices stats:', error)
    }
  }

  const fetchDateRangeTelemetry = async (deviceId, start, end) => {
    if (!deviceId || !start || !end) return
    try {
      const response = await axios.get(`/api/devices/${deviceId}/telemetry/range?startDate=${start}&endDate=${end}`)
      setDateRangeTelemetry(response.data.reverse()) // Reverse to show oldest first
    } catch (error) {
      console.error('Error fetching date range telemetry:', error)
    }
  }

  useEffect(() => {
    if (selectedDevice) {
      fetchTelemetry(selectedDevice)
      fetchCommandHistory(selectedDevice)
      fetchAnalytics(selectedDevice)
      const interval = setInterval(() => fetchTelemetry(selectedDevice), 5000)
      return () => clearInterval(interval)
    }
  }, [selectedDevice])

  useEffect(() => {
    if (errorMessage || successMessage) {
      const timeout = setTimeout(() => {
        setErrorMessage('')
        setSuccessMessage('')
      }, 5000)
      return () => clearTimeout(timeout)
    }
  }, [errorMessage, successMessage])


  const clearCommandHistory = async () => {
    if (!selectedDevice) return
    if (!window.confirm('Are you sure you want to clear the command history for this device?')) {
      return
    }
    try {
      await axios.delete(`/api/devices/${selectedDevice}/commands`)
      setCommandHistory([])
      setSuccessMessage('Command history cleared.')
      setErrorMessage('')
    } catch (error) {
      console.error('Error clearing command history:', error)
      setErrorMessage('Failed to clear command history')
    }
  }

  const sendCommand = async () => {
    setErrorMessage('')
    setSuccessMessage('')

    if (!selectedDevice) {
      setErrorMessage('No device selected.')
      return
    }
    if (!command || typeof command !== 'string' || command.trim() === '') {
      setErrorMessage('Command is required and must be a non-empty string.')
      return
    }

    let params = {}
    try {
      params = JSON.parse(parameters)
      if (typeof params !== 'object' || params === null) {
        throw new Error('Parameters must be a valid JSON object.')
      }
    } catch (e) {
      setErrorMessage('Parameters must be valid JSON (object).')
      return
    }

    try {
      const response = await axios.post(`/api/devices/${selectedDevice}/commands`, {
        command: command.trim(),
        parameters: params
      })
      setSuccessMessage(`Command sent (id=${response.data.command_id}).`)
      setCommand('')
      setParameters('{}')
      fetchCommandHistory(selectedDevice)
    } catch (error) {
      console.error('Error sending command:', error)
      setErrorMessage(
        error.response?.data?.error ||
          error.response?.statusText ||
          'Error sending command'
      )
    }
  }

  const sendBulkCommand = async () => {
    setErrorMessage('')
    setSuccessMessage('')

    if (bulkDevices.length === 0) {
      setErrorMessage('No devices selected for bulk command.')
      return
    }
    if (!bulkCommand || typeof bulkCommand !== 'string' || bulkCommand.trim() === '') {
      setErrorMessage('Command is required and must be a non-empty string.')
      return
    }

    let params = {}
    try {
      params = JSON.parse(bulkParameters)
      if (typeof params !== 'object' || params === null) {
        throw new Error('Parameters must be a valid JSON object.')
      }
    } catch (e) {
      setErrorMessage('Parameters must be valid JSON (object).')
      return
    }

    try {
      const response = await axios.post('/api/devices/commands/bulk', {
        deviceIds: bulkDevices,
        command: bulkCommand.trim(),
        parameters: params
      })
      const successCount = response.data.results.filter(r => r.status === 'success').length
      const errorCount = response.data.results.filter(r => r.status === 'error').length
      setSuccessMessage(`Bulk command sent: ${successCount} successful, ${errorCount} failed.`)
      setBulkCommand('')
      setBulkParameters('{}')
      setBulkDevices([])
      // Refresh command history for all affected devices
      bulkDevices.forEach(deviceId => {
        if (deviceId === selectedDevice) {
          fetchCommandHistory(deviceId)
        }
      })
    } catch (error) {
      console.error('Error sending bulk command:', error)
      setErrorMessage(
        error.response?.data?.error ||
          error.response?.statusText ||
          'Error sending bulk command'
      )
    }
  }

  return (
    <div className="app">
      <h1>IoT Device Dashboard</h1>
      
      <div className="device-selector">
        <label>Select Device:</label>
        <select value={selectedDevice} onChange={(e) => setSelectedDevice(e.target.value)}>
          {devices.map(device => (
            <option key={device.device_id} value={device.device_id}>
              {device.device_id} ({device.status})
            </option>
          ))}
        </select>
      </div>

      <div className="command-section">
        <h2>Send Command</h2>
        {errorMessage && <div className="message error">{errorMessage}</div>}
        {successMessage && <div className="message success">{successMessage}</div>}

        <div className="template-row">
          <label>Template:</label>
          <select
            value={template}
            onChange={(e) => {
              const sel = templates.find((t) => t.value === e.target.value)
              setTemplate(e.target.value)
              if (sel) {
                setCommand(sel.command)
                setParameters(sel.parameters)
              }
            }}
          >
            {templates.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <input
          type="text"
          placeholder="Command (e.g., restart, update_firmware)"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
        />
        <textarea
          placeholder='Parameters (JSON, e.g., {"version": "1.2.3"})'
          value={parameters}
          onChange={(e) => setParameters(e.target.value)}
        />
        <button onClick={sendCommand}>Send Command</button>
      </div>

      <div className="bulk-command-section">
        <h2>Bulk Commands</h2>
        <div className="bulk-devices">
          <label>Select Devices:</label>
          <div className="device-checkboxes">
            {devices.map(device => (
              <label key={device.device_id} className="device-checkbox">
                <input
                  type="checkbox"
                  checked={bulkDevices.includes(device.device_id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setBulkDevices([...bulkDevices, device.device_id])
                    } else {
                      setBulkDevices(bulkDevices.filter(id => id !== device.device_id))
                    }
                  }}
                />
                {device.device_id} ({device.status})
              </label>
            ))}
          </div>
        </div>
        <input
          type="text"
          placeholder="Bulk Command (e.g., restart)"
          value={bulkCommand}
          onChange={(e) => setBulkCommand(e.target.value)}
        />
        <textarea
          placeholder='Parameters (JSON, e.g., {"version": "1.2.3"})'
          value={bulkParameters}
          onChange={(e) => setBulkParameters(e.target.value)}
        />
        <button onClick={sendBulkCommand}>Send Bulk Command</button>
      </div>

      <div className="analytics-section">
        <h2>Analytics</h2>
        {analytics && (
          <div className="analytics-data">
            <div className="analytics-item">
              <strong>Total Records:</strong> {analytics.total_records}
            </div>
            <div className="analytics-item">
              <strong>Avg PV Voltage:</strong> {analytics.avg_pv_voltage?.toFixed(2)} V
            </div>
            <div className="analytics-item">
              <strong>Avg Battery Voltage:</strong> {analytics.avg_battery_voltage?.toFixed(2)} V
            </div>
            <div className="analytics-item">
              <strong>Avg Current:</strong> {analytics.avg_current?.toFixed(2)} A
            </div>
            <div className="analytics-item">
              <strong>Avg Temperature:</strong> {analytics.avg_temperature?.toFixed(2)} °C
            </div>
            <div className="analytics-item">
              <strong>Min Temperature:</strong> {analytics.min_temperature?.toFixed(2)} °C
            </div>
            <div className="analytics-item">
              <strong>Max Temperature:</strong> {analytics.max_temperature?.toFixed(2)} °C
            </div>
            <div className="analytics-item">
              <strong>Data Range:</strong> {analytics.first_record} to {analytics.last_record}
            </div>
          </div>
        )}

        <div className="date-range-section">
          <h3>Historical Data</h3>
          <div className="date-inputs">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              placeholder="Start Date"
            />
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              placeholder="End Date"
            />
            <button onClick={() => fetchDateRangeTelemetry(selectedDevice, startDate, endDate)}>
              Load Historical Data
            </button>
          </div>
        </div>

        {dateRangeTelemetry.length > 0 && (
          <div className="historical-chart">
            <h3>Historical Telemetry ({startDate} to {endDate})</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={dateRangeTelemetry}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="ts" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="pv_voltage" stroke="#8884d8" name="PV Voltage" />
                <Line type="monotone" dataKey="battery_voltage" stroke="#82ca9d" name="Battery Voltage" />
                <Line type="monotone" dataKey="current" stroke="#ffc658" name="Current" />
                <Line type="monotone" dataKey="temperature" stroke="#ff7300" name="Temperature" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="all-devices-stats">
          <h3>All Devices Summary</h3>
          <table>
            <thead>
              <tr>
                <th>Device ID</th>
                <th>Total Records</th>
                <th>Avg PV Voltage</th>
                <th>Avg Battery Voltage</th>
                <th>Avg Current</th>
                <th>Avg Temperature</th>
                <th>Last Update</th>
              </tr>
            </thead>
            <tbody>
              {allDevicesStats.map((stat) => (
                <tr key={stat.device_id}>
                  <td>{stat.device_id}</td>
                  <td>{stat.total_records}</td>
                  <td>{stat.avg_pv_voltage?.toFixed(2)}</td>
                  <td>{stat.avg_battery_voltage?.toFixed(2)}</td>
                  <td>{stat.avg_current?.toFixed(2)}</td>
                  <td>{stat.avg_temperature?.toFixed(2)}</td>
                  <td>{stat.last_record ? new Date(stat.last_record).toLocaleString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="charts">
        <h2>Real-time Telemetry</h2>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={telemetry}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="ts" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="pv_voltage" stroke="#8884d8" name="PV Voltage" />
            <Line type="monotone" dataKey="battery_voltage" stroke="#82ca9d" name="Battery Voltage" />
            <Line type="monotone" dataKey="current" stroke="#ffc658" name="Current" />
            <Line type="monotone" dataKey="temperature" stroke="#ff7300" name="Temperature" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="telemetry-table">
        <h2>Latest Telemetry Data</h2>
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>PV Voltage</th>
              <th>Battery Voltage</th>
              <th>Current</th>
              <th>Temperature</th>
            </tr>
          </thead>
          <tbody>
            {telemetry.slice(-10).reverse().map((data, index) => (
              <tr key={index}>
                <td>{new Date(data.ts).toLocaleString()}</td>
                <td>{data.pv_voltage?.toFixed(2)}</td>
                <td>{data.battery_voltage?.toFixed(2)}</td>
                <td>{data.current?.toFixed(2)}</td>
                <td>{data.temperature?.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="command-history">
        <h2>Command History</h2>
        <button className="clear-history" onClick={clearCommandHistory}>Clear history</button>
        {commandHistory.length === 0 ? (
          <p>No commands sent yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Command</th>
                <th>Parameters</th>
                <th>Status</th>
                <th>Created</th>
                <th>Executed</th>
              </tr>
            </thead>
            <tbody>
              {commandHistory.map((cmd) => (
                <tr key={cmd.id}>
                  <td>{cmd.id}</td>
                  <td>{cmd.command}</td>
                  <td>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                      {JSON.stringify(cmd.parameters || {}, null, 2)}
                    </pre>
                  </td>
                  <td>{cmd.status}</td>
                  <td>{new Date(cmd.created_at).toLocaleString()}</td>
                  <td>{cmd.executed_at ? new Date(cmd.executed_at).toLocaleString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default App