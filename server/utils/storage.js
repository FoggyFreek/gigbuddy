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

const publicConfig = {
  endPoint: process.env.RUSTFS_ENDPOINT || 'localhost',
  port: port(process.env.RUSTFS_PORT, 9000, 'RUSTFS_PORT'),
  useSSL: process.env.RUSTFS_USE_SSL === 'true',
  accessKey: process.env.RUSTFS_ACCESS_KEY,
  secretKey: process.env.RUSTFS_SECRET_KEY,
}

if (isProduction && !process.env.S3_PORT) throw new Error('S3_PORT environment variable must be set')
const privateRegion = requiredInProduction('S3_REGION', '')?.trim()
const privateConfig = {
  endPoint: requiredInProduction('S3_ENDPOINT', 'localhost'),
  port: port(process.env.S3_PORT, isProduction ? 443 : 9000, 'S3_PORT'),
  useSSL: process.env.S3_USE_SSL === 'true',
  accessKey: requiredInProduction('S3_ACCESS_KEY', process.env.RUSTFS_ACCESS_KEY),
  secretKey: requiredInProduction('S3_SECRET_KEY', process.env.RUSTFS_SECRET_KEY),
  ...(privateRegion ? { region: privateRegion } : {}),
}

if (isProduction && !privateConfig.useSSL) {
  throw new Error('S3_USE_SSL must be true in production')
}

export const PUBLIC_BUCKET = process.env.RUSTFS_BUCKET || 'gigbuddy'
export const PRIVATE_BUCKET = requiredInProduction('S3_BUCKET', 'gigbuddy-tenant')

if (
  publicConfig.endPoint === privateConfig.endPoint
  && publicConfig.port === privateConfig.port
  && PUBLIC_BUCKET === PRIVATE_BUCKET
) {
  throw new Error('Public and private object stores must use different buckets')
}

export const publicStorageClient = new Client(publicConfig)
export const privateStorageClient = new Client(privateConfig)

export const PUBLIC_STORE = Object.freeze({
  id: 'public',
  client: publicStorageClient,
  bucket: PUBLIC_BUCKET,
})

export const PRIVATE_STORE = Object.freeze({
  id: 'private',
  client: privateStorageClient,
  bucket: PRIVATE_BUCKET,
})

export const STORES = Object.freeze([PUBLIC_STORE, PRIVATE_STORE])

// Transitional aliases for existing test mocks and out-of-tree scripts.
export const storageClient = publicStorageClient
export const BUCKET = PUBLIC_BUCKET
