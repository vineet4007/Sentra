import mysql, {
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from 'mysql2/promise'

type MysqlConfig = {
  host: string
  port: number
  user: string
  password: string
  database: string
}

export type SqlParam =
  | string
  | number
  | bigint
  | boolean
  | Date
  | null
  | Buffer
  | Uint8Array
  | SqlParam[]
  | { [key: string]: SqlParam }

let pool: Pool | null = null

function parseGoStyleMysqlDsn(dsn?: string): Partial<MysqlConfig> {
  if (!dsn) return {}

  const match = /^([^:]+):([^@]*)@tcp\(([^:()]+):(\d+)\)\/([^?]+)/.exec(dsn)
  if (!match) return {}

  return {
    user: match[1],
    password: match[2],
    host: match[3],
    port: Number(match[4]),
    database: match[5],
  }
}

function resolveMysqlConfig(): MysqlConfig {
  const parsed = parseGoStyleMysqlDsn(process.env.MYSQL_DSN)
  const portValue = process.env.MYSQL_PORT || String(parsed.port || 3306)
  const port = Number(portValue)

  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid MySQL port: ${portValue}`)
  }

  return {
    host: process.env.MYSQL_HOST || parsed.host || 'localhost',
    port,
    user: process.env.MYSQL_USER || parsed.user || 'root',
    password: process.env.MYSQL_PASSWORD || parsed.password || '',
    database: process.env.MYSQL_DATABASE || parsed.database || 'sentra',
  }
}

export async function createDatabasePool(): Promise<Pool> {
  if (pool) return pool

  const config = resolveMysqlConfig()
  const nextPool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: false,
  })

  await nextPool.query('SELECT 1')
  pool = nextPool
  return nextPool
}

export async function closeDatabasePool(): Promise<void> {
  const currentPool = pool
  pool = null
  if (currentPool) {
    await currentPool.end()
  }
}

export function getDatabasePool(): Pool {
  if (!pool) throw new Error('MySQL not initialized')
  return pool
}

export async function pingDatabase(): Promise<void> {
  await getDatabasePool().query('SELECT 1')
}

export async function queryRows<T extends RowDataPacket[]>(
  sql: string,
  params: SqlParam[] = [],
): Promise<T> {
  const [rows] = await getDatabasePool().query<T>(sql, params)
  return rows
}

export async function executeStatement(
  sql: string,
  params: SqlParam[] = [],
): Promise<ResultSetHeader> {
  const [result] = await getDatabasePool().execute<ResultSetHeader>(sql, params)
  return result
}

export async function withTransaction<T>(
  fn: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
  const connection = await getDatabasePool().getConnection()
  try {
    await connection.beginTransaction()
    const result = await fn(connection)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export function toDbJson(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return JSON.stringify(value)
}

export function fromDbJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return null
    }
  }
  return value as T
}

export function toIsoString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  return null
}
