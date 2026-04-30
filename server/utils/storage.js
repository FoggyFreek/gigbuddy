import { Client } from 'minio'

export const storageClient = new Client({
  endPoint:  process.env.RUSTFS_ENDPOINT || 'localhost',
  port:      Number(process.env.RUSTFS_PORT) || 9000,
  useSSL:    process.env.RUSTFS_USE_SSL === 'true',
  accessKey: process.env.RUSTFS_ACCESS_KEY,
  secretKey: process.env.RUSTFS_SECRET_KEY,
})

export const BUCKET = process.env.RUSTFS_BUCKET || 'gigbuddy'
