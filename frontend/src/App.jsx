import { useEffect } from 'react'
import { useState } from 'react'
import axios from 'axios'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts'
import './index.css'

function App() {
  const [activeTab, setActiveTab] = useState('dashboard')

  // Dashboard state
  const [sites, setSites] = useState([])
  const [selectedSite, setSelectedSite] = useState('')
  const [selectedSiteName, setSelectedSiteName] = useState('')
  const [newSite, setNewSite] = useState({ site_id: '', site_name: '', oem: '', location: '', capacity_kw: '' })
  const [createMessage, setCreateMessage] = useState('')
  const [siteDevices, setSiteDevices] = useState([])
  const [dashboardSummary, setDashboardSummary] = useState(null)
  const [activeAlertsCount, setActiveAlertsCount] = useState(0)

  // Device state
  const [selectedDevice, setSelectedDevice] = useState('')
  const [telemetry, setTelemetry] = useState([])
  const [analytics, setAnalytics] = useState(null)

  // Alerts state
  const [alerts, setAlerts] = useState([])
  const [alertsFilter, setAlertsFilter] = useState('unresolved')

  // Reports state
  const [weeklyReports, setWeeklyReports] = useState([])
  const [reportSiteFilter, setReportSiteFilter] = useState('')

  // Command state
  const [command, setCommand] = useState('')
  const [parameters, setParameters] = useState('{}')
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const templates = [
    { value: '', label: '— none —', command: '', parameters: '{}' },
    { value: 'restart', label: 'Restart', command: 'restart', parameters: '{}' },
  ]

  // Initial data fetches
  const fetchSites = async () => {
    try {
      const response = await axios.get('/api/sites')
      setSites(response.data)
    } catch (error) {
      console.error('Error fetching sites:', error)
    }
  }

  const fetchActiveAlertsCount = async () => {
    try {
      const response = await axios.get('/api/alerts/count')
      setActiveAlertsCount(response.data.active_alerts || 0)
    } catch (error) {
      console.error('Error fetching active alerts count:', error)
    }
  }

  useEffect(() => {
    fetchSites()
    fetchActiveAlertsCount()
    fetchAlertsData()
    fetchWeeklyReportsData()

    // Poll sites and alerts periodically so UI reflects backend changes
    const pollInterval = setInterval(() => {
      fetchSites()
      fetchActiveAlertsCount()
    }, 30000) // every 30 seconds

    return () => clearInterval(pollInterval)
  }, [])

  useEffect(() => {
    if (!selectedSite) return

    const fetchDevicesForSite = async () => {
      try {
        const response = await axios.get(`/api/sites/${selectedSite}/devices`)
        setSiteDevices(response.data)
        if (response.data.length > 0) {
          setSelectedDevice(response.data[0].device_id)
        }
      } catch (error) {
        console.error('Error fetching site devices:', error)
      }
    }

    fetchDevicesForSite()
  }, [selectedSite])

  const fetchTelemetry = async (deviceId) => {
    if (!deviceId) {
      setTelemetry([])
      return
    }

    try {
      const response = await axios.get(`/api/telemetry/${deviceId}`)
      setTelemetry(response.data)
    } catch (error) {
      console.error('Error fetching telemetry:', error)
      setTelemetry([])
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

  useEffect(() => {
    if (!selectedDevice) {
      setTelemetry([])
      setAnalytics(null)
      return
    }

    fetchTelemetry(selectedDevice)
    fetchAnalytics(selectedDevice)
  }, [selectedDevice])

  const fetchAlertsData = async () => {
    try {
      const response = await axios.get(
        `/api/alerts?unresolved=${alertsFilter === 'unresolved'}`
      )
      setAlerts(response.data)
    } catch (error) {
      console.error('Error fetching alerts:', error)
    }
  }

  const fetchWeeklyReportsData = async () => {
    try {
      const response = await axios.get('/api/reports/weekly?weeks=12')
      setWeeklyReports(response.data)
    } catch (error) {
      console.error('Error fetching reports:', error)
    }
  }

  const resolveAlert = async (alertId) => {
    try {
      await axios.post(`/api/alerts/${alertId}/resolve`)
      setSuccessMessage('Alert resolved successfully')
      fetchAlertsData()
    } catch (error) {
      console.error('Error resolving alert:', error)
      setErrorMessage('Failed to resolve alert')
    }
  }

  const sendCommand = async () => {
    setErrorMessage('')
    setSuccessMessage('')

    if (!selectedDevice) {
      setErrorMessage('No device selected.')
      return
    }

    if (!command || command.trim() === '') {
      setErrorMessage('Command is required.')
      return
    }

    let params = {}

    try {
      params = JSON.parse(parameters)
    } catch (e) {
      setErrorMessage('Parameters must be valid JSON.')
      return
    }

    try {
      const response = await axios.post(
        `/api/devices/${selectedDevice}/commands`,
        {
          command: command.trim(),
          parameters: params,
        }
      )

      setSuccessMessage(`Command sent (id=${response.data.command_id}).`)
      setCommand('')
      setParameters('{}')
    } catch (error) {
      console.error('Error sending command:', error)
      setErrorMessage('Error sending command')
    }
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'ok':
        return '#22c55e'
      case 'warning':
        return '#f59e0b'
      case 'offline':
        return '#ef4444'
      default:
        return '#6b7280'
    }
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A'
    return new Date(dateStr).toLocaleString()
  }

  const renderDashboard = () => (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Multi-OEM Site Dashboard</h2>
      </div>

      <div className="sites-grid">
        <table>
          <thead>
            <tr>
              <th>Site</th>
              <th>OEM</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((site) => (
              <tr
                key={site.site_id}
                style={
                  selectedSite === site.site_id
                    ? { backgroundColor: '#eef6ff' }
                    : {}
                }
              >
                <td>{site.site_name}</td>
                <td>{site.oem}</td>
                <td>
                  <span
                    style={{
                      backgroundColor: getStatusColor(site.status),
                      padding: '4px 8px',
                      borderRadius: '4px',
                      color: 'white',
                    }}
                  >
                    {site.status}
                  </span>
                </td>
                <td>
                  <button
                    onClick={() => {
                      setSelectedSite(site.site_id)
                      setSelectedSiteName(site.site_name)
                    }}
                  >
                    Select
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedSite && (
        <div className="site-details">
          <h3>Selected Site: {selectedSiteName || selectedSite}</h3>

          <select
            value={selectedDevice}
            onChange={(e) => {
              setSelectedDevice(e.target.value)
              fetchAnalytics(e.target.value)
            }}
          >
            <option value="">Select Device</option>

            {siteDevices.map((device) => (
              <option key={device.device_id} value={device.device_id}>
                {device.device_id}
              </option>
            ))}
          </select>

          {analytics && (
            <div className="analytics-data">
              <h4>Device Analytics</h4>
              <p>Total Records: {analytics.total_records}</p>
              <p>
                Avg PV Voltage:{' '}
                {analytics.avg_pv_voltage?.toFixed(2)} V
              </p>
            </div>
          )}

          {telemetry.length > 0 && (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={telemetry}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="ts" />
                <YAxis />
                <Tooltip />
                <Legend />

                <Line
                  type="monotone"
                  dataKey="pv_voltage"
                  stroke="#8884d8"
                />
              </LineChart>
            </ResponsiveContainer>
          )}

          <div className="command-section">
            <h4>Send Command</h4>

            {errorMessage && (
              <div className="message error">{errorMessage}</div>
            )}

            {successMessage && (
              <div className="message success">{successMessage}</div>
            )}

            <select
              value={command}
              onChange={(e) => {
                const sel = templates.find(
                  (t) => t.value === e.target.value
                )

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

            <input
              type="text"
              placeholder="Command"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />

            <textarea
              placeholder="Parameters JSON"
              value={parameters}
              onChange={(e) => setParameters(e.target.value)}
            />

            <button onClick={sendCommand}>Send Command</button>
          </div>
        </div>
      )}
    </div>
  )

  const renderAlerts = () => (
    <div className="alerts-panel">
      <h2>Alerts</h2>

      <button onClick={fetchAlertsData}>Refresh Alerts</button>

      {alerts.map((alert) => (
        <div key={alert.id} className="alert-card">
          <p>{alert.message}</p>

          {!alert.is_resolved && (
            <button onClick={() => resolveAlert(alert.id)}>
              Resolve
            </button>
          )}
        </div>
      ))}
    </div>
  )

  const renderReports = () => (
    <div className="reports-panel">
      <h2>Weekly Reports</h2>

      <button onClick={fetchWeeklyReportsData}>
        Load Reports
      </button>

      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={weeklyReports}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="site_name" />
          <YAxis />
          <Tooltip />
          <Legend />

          <Bar
            dataKey="uptime_percentage"
            fill="#22c55e"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )

  const renderAddSite = () => (
    <div className="add-site-panel">
      <h2>Create Site</h2>

      {createMessage && <div className="message">{createMessage}</div>}

      <form onSubmit={async (e) => {
        e.preventDefault()
        setCreateMessage('')
        try {
          await axios.post('/api/sites', newSite)
          setCreateMessage('Site created/updated successfully')
          await fetchSites()
          setSelectedSite(newSite.site_id)
          setSelectedSiteName(newSite.site_name)
          setActiveTab('dashboard')
          setNewSite({ site_id: '', site_name: '', oem: '', location: '', capacity_kw: '' })
        } catch (err) {
          console.error('Error creating site:', err)
          setCreateMessage('Failed to create site: ' + (err.response?.data?.error || err.message))
        }
      }}>
        <div>
          <label>Site ID</label>
          <input value={newSite.site_id} onChange={(e) => setNewSite({ ...newSite, site_id: e.target.value })} required />
        </div>

        <div>
          <label>Site Name</label>
          <input value={newSite.site_name} onChange={(e) => setNewSite({ ...newSite, site_name: e.target.value })} required />
        </div>

        <div>
          <label>OEM</label>
          <input value={newSite.oem} onChange={(e) => setNewSite({ ...newSite, oem: e.target.value })} required />
        </div>

        <div>
          <label>Location</label>
          <input value={newSite.location} onChange={(e) => setNewSite({ ...newSite, location: e.target.value })} />
        </div>

        <div>
          <label>Capacity (kW)</label>
          <input value={newSite.capacity_kw} onChange={(e) => setNewSite({ ...newSite, capacity_kw: e.target.value })} />
        </div>

        <button type="submit">Create Site</button>
      </form>
    </div>
  )

  return (
    <div className="app">
      <header className="app-header">
        <h1>IoT Solar Dashboard</h1>

        <nav className="nav-tabs">
          <button
            className={activeTab === 'dashboard' ? 'active' : ''}
            onClick={() => setActiveTab('dashboard')}
          >
            Dashboard
          </button>

          <button
            className={activeTab === 'alerts' ? 'active' : ''}
            onClick={() => setActiveTab('alerts')}
          >
            Alerts ({activeAlertsCount})
          </button>

          <button
            className={activeTab === 'reports' ? 'active' : ''}
            onClick={() => setActiveTab('reports')}
          >
            Reports
          </button>
          <button
            className={activeTab === 'add-site' ? 'active' : ''}
            onClick={() => setActiveTab('add-site')}
          >
            Add Site
          </button>
        </nav>
      </header>

      <main className="app-content">
        {activeTab === 'dashboard' && renderDashboard()}
        {activeTab === 'alerts' && renderAlerts()}
        {activeTab === 'reports' && renderReports()}
        {activeTab === 'add-site' && renderAddSite()}
      </main>
    </div>
  )
}

export default App