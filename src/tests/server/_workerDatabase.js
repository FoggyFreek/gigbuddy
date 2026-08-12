// setupFile for the server suite: runs inside each worker, before the test
// module is imported, and guarantees this worker's database exists.
//
// The clone is per worker, not per test file — a worker runs its files
// sequentially, so they keep sharing one database and the existing
// truncateAll()/seedTwoTenants() rhythm. That is ~8 clones instead of ~95.
import 'dotenv/config'
import {
  resolveTestDatabase,
  templateDatabaseName,
  workerDatabaseName,
} from './_databaseGuard.js'
import {
  withAdminClient,
  createFromTemplate,
  databaseExists,
  relaxDurability,
} from './_databaseAdmin.js'

// Opt-in marker read by _envSetup.js. Only the server config loads this file,
// so a run against the plain vite config still targets the single base database.
process.env.GIGBUDDY_TEST_WORKER_DB = '1'

const base = resolveTestDatabase(process.env)
const template = templateDatabaseName(base)
const worker = workerDatabaseName(base, process.env.VITEST_POOL_ID)

await withAdminClient(async (client) => {
  if (await databaseExists(client, worker)) return
  if (!(await databaseExists(client, template))) {
    throw new Error(
      `Template database '${template}' is missing. Run the server suite through ` +
      'vitest.server.config.js so its globalSetup can build it.',
    )
  }
  await createFromTemplate(client, worker, template)
  await relaxDurability(client, worker)
})

// Import order matters: _envSetup must see GIGBUDDY_TEST_WORKER_DB, and it must
// run before any server module builds the pg pool.
await import('./_envSetup.js')
