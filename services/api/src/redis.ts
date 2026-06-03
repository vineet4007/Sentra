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

export async function closeClient(): Promise<void> {
  const currentClient = redis
  redis = null
  if (currentClient) {
    await currentClient.quit()
  }
}

export function getClient(): Redis {
  if (!redis) throw new Error('Redis not initialized')
  return redis
}
