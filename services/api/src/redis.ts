import Redis from 'ioredis'

let redis: Redis | null = null

export async function createClient(): Promise<Redis> {
  if (redis) return redis
  const url = process.env.REDIS_URL || 'redis://localhost:6379'
  const client = new Redis(url)
  await client.ping()
  redis = client
  return client
}

export function getClient(): Redis {
  if (!redis) throw new Error('Redis not initialized')
  return redis
}
