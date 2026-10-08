import { Pool } from 'pg'
const connString = process.env.DSN

const pool = new Pool({
  connectionString: connString,
})

export default pool
