jest.setTimeout(20000)

const path = require('path')
const { pathToFileURL } = require('url')

const dbUrl = process.env.TEST_DB_URL || process.env.DB_URL

if (!dbUrl) {
  test('DB integration skipped - no DB URL', () => {
    expect(true).toBe(true)
  })
} else {
  test('DB integration: create tokens and revoke them (real Postgres)', async () => {
    // Ensure db.js uses our DB URL
    process.env.DB_URL = dbUrl

    const dbModule = await import(pathToFileURL(path.resolve(__dirname, '..', 'db.js')).href)
    const {
      createUser,
      createAccessToken,
      validateAccessToken,
      revokeAccessToken,
      createRefreshToken,
      validateRefreshToken,
      revokeRefreshToken,
      pool,
      getUserById
    } = dbModule

    const username = `test_integ_${Date.now()}`
    let user
    try {
      user = await createUser(username, 'TestPass123!', ['admin'])

      // Create access token
      const access = await createAccessToken(user.id, 5) // minutes
      expect(access).toHaveProperty('token')

      // Validate access token exists
      const validAccess = await validateAccessToken(access.token)
      expect(validAccess).not.toBeNull()
      expect(validAccess.user_id).toBe(user.id)

      // Revoke and confirm
      await revokeAccessToken(access.token)
      const afterRevoke = await validateAccessToken(access.token)
      expect(afterRevoke).toBeNull()

      // Create refresh token
      const refresh = await createRefreshToken(user.id, 1) // days
      expect(refresh).toHaveProperty('token')

      const validRefresh = await validateRefreshToken(refresh.token)
      expect(validRefresh).not.toBeNull()
      expect(validRefresh.user_id).toBe(user.id)

      await revokeRefreshToken(refresh.token)
      const afterRefreshRevoke = await validateRefreshToken(refresh.token)
      expect(afterRefreshRevoke).toBeNull()

    } finally {
      // Clean up test data
      if (user && user.id) {
        await pool.query('DELETE FROM access_tokens WHERE user_id=$1', [user.id])
        await pool.query('DELETE FROM refresh_tokens WHERE user_id=$1', [user.id])
        await pool.query('DELETE FROM api_keys WHERE user_id=$1', [user.id])
        await pool.query('DELETE FROM users WHERE id=$1', [user.id])
      }
      // close pool
      await pool.end()
    }
  })
}
