#!/usr/bin/env node
/**
 * CLI tool to validate JWT tokens and show JWKS information
 * Usage: npm run validate-token <jwt-token>
 * Or: ts-node src/cli-validate-token.ts <jwt-token>
 */
import axios from 'axios'
import { Effect } from 'effect'
import { decodeJwt, decodeProtectedHeader } from 'jose'
import { appConfig } from './config.js'
import { JWTService, JWTServiceLive, type JWKS } from './fp/services/jwt.js'

// Get token from command line
const token = process.argv[2]

if (!token) {
  console.error('Usage: npm run validate-token <jwt-token>')
  console.error('   or: ts-node src/cli-validate-token.ts <jwt-token>')
  process.exit(1)
}

console.log('\n=== JWT Token Validation Tool ===\n')

// Decode token header and payload (without verification)
try {
  const header = decodeProtectedHeader(token)
  const payload = decodeJwt(token)

  console.log('📋 Token Header:')
  console.log(JSON.stringify(header, null, 2))
  console.log('\n📋 Token Claims (unverified):')
  console.log(JSON.stringify(payload, null, 2))
  console.log()

  if (header.kid) {
    console.log(`🔑 Token uses Key ID (kid): ${header.kid}`)
  } else {
    console.log('⚠️  Warning: Token has no kid in header')
  }
} catch (error) {
  console.error('❌ Failed to decode token:', error)
  process.exit(1)
}

// Fetch JWKS based on configured provider
const jwksUrl = appConfig.jwtProvider === 'google'
  ? 'https://www.googleapis.com/oauth2/v3/certs'
  : `${appConfig.hydraPublicUrl}/.well-known/jwks.json`

console.log(`\n📥 Fetching JWKS from ${appConfig.jwtProvider.toUpperCase()}...`)
console.log(`   URL: ${jwksUrl}`)

const fetchJWKS = async (): Promise<JWKS> => {
  try {
    const response = await axios.get<JWKS>(jwksUrl)
    return response.data
  } catch (error) {
    throw new Error(`Failed to fetch JWKS: ${String(error)}`)
  }
}

// Verify token using JWT service
const validateToken = async () => {
  try {
    // Fetch and display JWKS
    const jwks = await fetchJWKS()
    console.log('\n🔐 Available Keys in JWKS:')
    jwks.keys.forEach((key, index) => {
      console.log(`   Key ${index + 1}:`)
      console.log(`     - kid: ${key.kid}`)
      console.log(`     - kty: ${key.kty}`)
      console.log(`     - alg: ${key.alg}`)
      console.log(`     - use: ${key.use}`)
      if (key.n) {
        console.log(`     - n (modulus): ${key.n.substring(0, 40)}...`)
      }
    })

    // Create JWT service
    const jwtService = JWTServiceLive({
      provider: appConfig.jwtProvider,
      issuer: appConfig.jwtIssuer,
      audience: appConfig.jwtAudience,
      hydraPublicUrl: appConfig.hydraPublicUrl,
      hydraAdminUrl: appConfig.hydraInternalAdmin,
    })

    console.log('\n✅ Verifying token...')

    // Verify the token
    const program = Effect.gen(function* () {
      const jwt = yield* JWTService
      const claims = yield* jwt.verify(token)
      return claims
    })

    const claims = await Effect.runPromise(Effect.provide(program, jwtService))

    console.log('\n✅ Token is VALID!')
    console.log('\n📋 Verified Claims:')
    console.log(JSON.stringify(claims, null, 2))

    console.log('\n🎯 Validation Summary:')
    console.log(`   - Subject (sub): ${claims.sub}`)
    console.log(`   - Client ID: ${claims.client_id}`)
    console.log(`   - Scopes: ${claims.scope}`)
    console.log(`   - JWT ID (jti): ${claims.jti}`)
    if (claims.kid) {
      console.log(`   - Key ID (kid): ${claims.kid}`)
    }
    console.log(`   - Issued At: ${new Date(claims.iat * 1000).toISOString()}`)
    console.log(`   - Expires At: ${new Date(claims.exp * 1000).toISOString()}`)

    const now = Math.floor(Date.now() / 1000)
    const timeUntilExpiry = claims.exp - now
    if (timeUntilExpiry > 0) {
      console.log(`   - Time until expiry: ${timeUntilExpiry} seconds`)
    } else {
      console.log(`   - ⚠️  Token expired ${Math.abs(timeUntilExpiry)} seconds ago`)
    }

    console.log('\n✨ Token validation complete!\n')
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Token Verification Failed!')
    console.error(`   Error: ${String(error)}`)
    console.error('\nPossible reasons:')
    console.error('   - Token signature is invalid')
    console.error('   - Token is expired')
    console.error('   - Token issuer/audience does not match')
    console.error('   - Token was not signed with a key in the JWKS')
    console.error()
    process.exit(1)
  }
}

// Run validation
validateToken().catch((error) => {
  console.error('Unexpected error:', error)
  process.exit(1)
})
