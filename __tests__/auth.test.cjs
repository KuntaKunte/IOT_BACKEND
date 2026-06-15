const request = require('supertest')
const express = require('express')

function parseCookiesHeader(header) {
  const cookies = {}
  if (!header) return cookies
  header.split(';').forEach((c) => {
    const [k, ...v] = c.split('=')
    if (!k) return
    cookies[k.trim()] = decodeURIComponent(v.join('=').trim())
  })
  return cookies
}

function createAuthApp(mocks) {
  const app = express()
  app.use(express.json())

  function parseCookies(req) {
    const header = req.headers.cookie || ''
    return parseCookiesHeader(header)
  }

  const getAccessTokenFromRequest = (req) => {
    const headerToken = req.headers['x-api-key']
    if (headerToken) return headerToken
    const cookies = parseCookies(req)
    return cookies.access_token
  }

  const getRefreshTokenFromRequest = (req) => parseCookies(req).refresh_token

  const authenticateApiKey = async (req, res, next) => {
    const authToken = getAccessTokenFromRequest(req)
    if (!authToken) return res.status(401).json({ error: 'Authentication required' })

    try {
      let keyRecord = null
      if (mocks.validateApiKey) keyRecord = await mocks.validateApiKey(authToken)
      if (!keyRecord && mocks.validateAccessToken) keyRecord = await mocks.validateAccessToken(authToken)
      if (!keyRecord) return res.status(403).json({ error: 'Invalid or expired token' })

      req.user = { userId: keyRecord.user_id, username: keyRecord.username, roles: keyRecord.roles || [] }
      next()
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { username, password } = req.body
      const user = await mocks.verifyUserCredentials(username, password)
      if (!user) return res.status(401).json({ error: 'Invalid credentials' })

      const accessToken = await mocks.createAccessToken(user.id, 15)
      const refreshToken = await mocks.createRefreshToken(user.id, 30)
      if (mocks.logAuditEvent) await mocks.logAuditEvent(user.id, 'LOGIN', user.id.toString(), { username })

      res.cookie('access_token', accessToken.token, { httpOnly: true })
      res.cookie('refresh_token', refreshToken.token, { httpOnly: true })

      res.json({ user: { id: user.id, username: user.username, roles: user.roles }, expires_at: accessToken.expires_at })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/auth/refresh', async (req, res) => {
    try {
      const refreshToken = getRefreshTokenFromRequest(req)
      if (!refreshToken) return res.status(401).json({ error: 'Refresh token required' })

      const tokenRecord = await mocks.validateRefreshToken(refreshToken)
      if (!tokenRecord) return res.status(403).json({ error: 'Invalid or expired refresh token' })

      const user = await mocks.getUserById(tokenRecord.user_id)
      if (!user) return res.status(404).json({ error: 'User not found' })

      await mocks.revokeRefreshToken(refreshToken)
      const newAccessToken = await mocks.createAccessToken(user.id, 15)
      const newRefreshToken = await mocks.createRefreshToken(user.id, 30)

      res.cookie('access_token', newAccessToken.token, { httpOnly: true })
      res.cookie('refresh_token', newRefreshToken.token, { httpOnly: true })

      res.json({ user: { id: user.id, username: user.username, roles: user.roles }, expires_at: newAccessToken.expires_at })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/auth/me', authenticateApiKey, (req, res) => {
    res.json({ id: req.user.userId, username: req.user.username, roles: req.user.roles })
  })

  app.post('/api/auth/logout', authenticateApiKey, async (req, res) => {
    try {
      const accessToken = getAccessTokenFromRequest(req)
      const refreshToken = getRefreshTokenFromRequest(req)
      if (accessToken && mocks.revokeAccessToken) await mocks.revokeAccessToken(accessToken)
      if (refreshToken && mocks.revokeRefreshToken) await mocks.revokeRefreshToken(refreshToken)
      if (mocks.logAuditEvent) await mocks.logAuditEvent(req.user.userId, 'LOGOUT', req.user.userId.toString(), {})
      res.clearCookie('access_token')
      res.clearCookie('refresh_token')
      res.json({ status: 'ok' })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  return app
}

test('login sets cookies and returns user', async () => {
  const user = { id: 1, username: 'admin', roles: ['admin'] }
  const mocks = {
    verifyUserCredentials: jest.fn().mockResolvedValue(user),
    createAccessToken: jest.fn().mockResolvedValue({ token: 'a1', expires_at: new Date().toISOString() }),
    createRefreshToken: jest.fn().mockResolvedValue({ token: 'r1', expires_at: new Date().toISOString() }),
    logAuditEvent: jest.fn()
  }

  const app = createAuthApp(mocks)
  const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'pw' })

  expect(res.status).toBe(200)
  expect(res.body.user).toMatchObject({ username: 'admin' })
  expect(res.headers['set-cookie']).toBeDefined()
  const cookies = res.headers['set-cookie'].join('; ')
  expect(cookies).toMatch(/access_token=/)
  expect(cookies).toMatch(/refresh_token=/)
})

test('refresh rotates tokens and returns user', async () => {
  const user = { id: 2, username: 'operator', roles: ['operator'] }
  const mocks = {
    validateRefreshToken: jest.fn().mockResolvedValue({ user_id: 2 }),
    getUserById: jest.fn().mockResolvedValue(user),
    revokeRefreshToken: jest.fn().mockResolvedValue(true),
    createAccessToken: jest.fn().mockResolvedValue({ token: 'a2', expires_at: new Date().toISOString() }),
    createRefreshToken: jest.fn().mockResolvedValue({ token: 'r2', expires_at: new Date().toISOString() })
  }

  const app = createAuthApp(mocks)
  const res = await request(app).post('/api/auth/refresh').set('Cookie', ['refresh_token=r2']).send()

  expect(res.status).toBe(200)
  expect(res.body.user).toMatchObject({ username: 'operator' })
  expect(res.headers['set-cookie']).toBeDefined()
  const cookies = res.headers['set-cookie'].join('; ')
  expect(cookies).toMatch(/access_token=/)
  expect(cookies).toMatch(/refresh_token=/)
  expect(mocks.revokeRefreshToken).toHaveBeenCalled()
})

test('logout revokes tokens and clears cookies', async () => {
  const user = { id: 3, username: 'joe', roles: [] }
  const mocks = {
    validateAccessToken: jest.fn().mockResolvedValue({ user_id: 3, username: 'joe', roles: [] }),
    revokeAccessToken: jest.fn().mockResolvedValue(true),
    revokeRefreshToken: jest.fn().mockResolvedValue(true),
    logAuditEvent: jest.fn()
  }

  const app = createAuthApp(mocks)
  const res = await request(app).post('/api/auth/logout').set('Cookie', ['access_token=a3', 'refresh_token=r3']).send()

  expect(res.status).toBe(200)
  expect(res.body.status).toBe('ok')
  expect(mocks.revokeAccessToken).toHaveBeenCalled()
  expect(mocks.revokeRefreshToken).toHaveBeenCalled()
})