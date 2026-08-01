import { Client } from 'minio'

const isProduction = process.env.NODE_ENV === 'production'

function port(value, fallback, name) {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be a valid TCP port`)
  }
  return parsed
}

function requiredInProduction(name, fallback) {
  const configured = process.env[name]
  if (isProduction && !configured) throw new Error(`${name} environment variable must be set`)
  return configured || fallback
}

const endpoint = requiredInProduction(
  'S3_ENDPOINT',
  process.env.RUSTFS_ENDPOINT || 'localhost',
)
const useSSL = process.env.S3_USE_SSL
  ? process.env.S3_USE_SSL === 'true'
  : process.env.RUSTFS_USE_SSL === 'true'
const region = requiredInProduction('S3_REGION', '')?.trim()
const configuredPort = process.env.S3_PORT || process.env.RUSTFS_PORT

if (isProduction && !process.env.S3_PORT) {
  throw new Error('S3_PORT environment variable must be set')
}
if (isProduction && !useSSL) {
  throw new Error('S3_USE_SSL must be true in production')
}

export const BUCKET = requiredInProduction(
  'S3_BUCKET',
  process.env.RUSTFS_PRIVATE_BUCKET || 'gigbuddy-tenant',
)

const storageConfig = {
  endPoint: endpoint,
  port: port(configuredPort, isProduction ? 443 : 9000, 'S3_PORT'),
  useSSL,
  accessKey: requiredInProduction('S3_ACCESS_KEY', process.env.RUSTFS_ACCESS_KEY),
  secretKey: requiredInProduction('S3_SECRET_KEY', process.env.RUSTFS_SECRET_KEY),
  ...(region ? { region } : {}),
}

function providerForEndpoint(value) {
  const normalized = value.toLowerCase()
  if (normalized === 'localhost' || normalized === '127.0.0.1' || normalized === 'rustfs') {
    return 'rustfs'
  }
  if (normalized.includes('backblaze')) return 'backblaze'
  return 's3'
}

export const STORAGE_INFO = Object.freeze({
  provider: providerForEndpoint(storageConfig.endPoint),
  endpoint: `${storageConfig.useSSL ? 'https' : 'http'}://${storageConfig.endPoint}:${storageConfig.port}`,
  bucket: BUCKET,
  configured: Boolean(storageConfig.accessKey && storageConfig.secretKey && BUCKET),
})

export const storageClient = new Client(storageConfig)
