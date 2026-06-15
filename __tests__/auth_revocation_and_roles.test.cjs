const request = require('supertest')
const express = require('express')

function createAuthAppWithAdmin(mocks) {
  const app = express()
  app.use(express.json())

  function parseCookies(req) {
    const header = req.headers.cookie || ''
    const cookies = {}
    header.split(';').forEach((c) => {
      const [k, ...v] = c.split('=')
      if (!k) return
      cookies[k.trim()] = decodeURIComponent(v.join('=').trim())
    })
    return cookies
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

  // auth endpoints (login/refresh/logout/me)
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

  // Admin-only endpoint for role enforcement tests
  app.get('/api/admin', authenticateApiKey, (req, res) => {
    if (!req.user.roles.includes('admin')) return res.status(403).json({ error: 'forbidden' })
    res.json({ ok: true })
  })

  return app
}

test('token revocation prevents access after logout', async () => {
  // in-memory token store to simulate DB rows
  const accessTokens = new Map()
  const refreshTokens = new Map()

  const user = { id: 10, username: 'revuser', roles: ['admin'] }

  const mocks = {
    verifyUserCredentials: jest.fn().mockResolvedValue(user),
    logAuditEvent: jest.fn(),
    createAccessToken: jest.fn().mockImplementation(async (userId) => {
      const token = `a-${Math.random().toString(36).slice(2,8)}`
      accessTokens.set(token, { user_id: userId, revoked: false, token })
      return { token, expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() }
    }),
    createRefreshToken: jest.fn().mockImplementation(async (userId) => {
      const token = `r-${Math.random().toString(36).slice(2,8)}`
      refreshTokens.set(token, { user_id: userId, revoked: false, token })
      return { token, expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() }
    }),
    validateAccessToken: jest.fn().mockImplementation(async (token) => {
      const rec = accessTokens.get(token)
      if (!rec || rec.revoked) return null
      return { ...rec, username: user.username, roles: user.roles }
    }),
    validateRefreshToken: jest.fn().mockImplementation(async (token) => {
      const rec = refreshTokens.get(token)
      if (!rec || rec.revoked) return null
      return { ...rec }
    }),
    revokeAccessToken: jest.fn().mockImplementation(async (token) => {
      const rec = accessTokens.get(token)
      if (rec) rec.revoked = true
      accessTokens.set(token, rec)
    }),
    revokeRefreshToken: jest.fn().mockImplementation(async (token) => {
      const rec = refreshTokens.get(token)
      if (rec) rec.revoked = true
      refreshTokens.set(token, rec)
    }),
    getUserById: jest.fn().mockResolvedValue(user)
  }

  const app = createAuthAppWithAdmin(mocks)

  // login
  const loginRes = await request(app).post('/api/auth/login').send({ username: 'revuser', password: 'pw' })
  expect(loginRes.status).toBe(200)
  const setCookies = loginRes.headers['set-cookie']
  expect(setCookies).toBeDefined()
  // extract tokens
  const cookieString = setCookies.join('; ')
  const accessMatch = cookieString.match(/access_token=([^;\s]+)/)
  const refreshMatch = cookieString.match(/refresh_token=([^;\s]+)/)
  expect(accessMatch).toBeTruthy()
  expect(refreshMatch).toBeTruthy()
  const accessToken = accessMatch[1]
  const refreshToken = refreshMatch[1]

  // access protected endpoint with valid access token
  const meRes = await request(app).get('/api/auth/me').set('Cookie', [`access_token=${accessToken}`])
  expect(meRes.status).toBe(200)
  expect(meRes.body.username).toBe('revuser')

  // logout (should revoke tokens)
  const logoutRes = await request(app).post('/api/auth/logout').set('Cookie', [`access_token=${accessToken}`, `refresh_token=${refreshToken}`]).send()
  expect(logoutRes.status).toBe(200)
  expect(mocks.revokeAccessToken).toHaveBeenCalled()
  expect(mocks.revokeRefreshToken).toHaveBeenCalled()

  // subsequent access should fail because access token revoked
  const meAfterRes = await request(app).get('/api/auth/me').set('Cookie', [`access_token=${accessToken}`])
  expect(meAfterRes.status).toBe(403)
})

test('admin endpoint enforces roles', async () => {
  const userAdmin = { id: 20, username: 'adminuser', roles: ['admin'] }
  const userOper = { id: 21, username: 'opuser', roles: ['operator'] }

  // simple token store
  const tokens = new Map()
  function makeMocksFor(user) {
    const tokens = new Map()
    const mocks = {
      verifyUserCredentials: jest.fn().mockResolvedValue(user),
      createAccessToken: jest.fn().mockImplementation(async (userId) => {
        const token = `t-${Math.random().toString(36).slice(2,8)}`
        tokens.set(token, { user_id: userId, username: user.username, roles: user.roles, revoked: false })
        return { token, expires_at: new Date().toISOString() }
      }),
      validateAccessToken: jest.fn().mockImplementation(async (token) => {
        const r = tokens.get(token)
        if (!r || r.revoked) return null
        return { ...r }
      }),
      revokeAccessToken: jest.fn().mockImplementation(async (token) => {
        const r = tokens.get(token)
        if (r) r.revoked = true
        tokens.set(token, r)
      }),
    }
    return { mocks, tokens }
  }

  // Admin user should be allowed
  const { mocks: mocksAdmin, tokens: tokensAdmin } = makeMocksFor(userAdmin)
  const appAdmin = createAuthAppWithAdmin(mocksAdmin)
  await request(appAdmin).post('/api/auth/login').send({ username: 'adminuser', password: 'pw' })
  const accessToken = Array.from(tokensAdmin.keys())[0]
  const adminRes = await request(appAdmin).get('/api/admin').set('Cookie', [`access_token=${accessToken}`])
  expect(adminRes.status).toBe(200)

  // Operator user should be forbidden
  const { mocks: mocksOper, tokens: tokensOper } = makeMocksFor(userOper)
  const appOper = createAuthAppWithAdmin(mocksOper)
  await request(appOper).post('/api/auth/login').send({ username: 'opuser', password: 'pw' })
  const accessToken2 = Array.from(tokensOper.keys())[0]
  const forbiddenRes = await request(appOper).get('/api/admin').set('Cookie', [`access_token=${accessToken2}`])
  expect(forbiddenRes.status).toBe(403)
})
