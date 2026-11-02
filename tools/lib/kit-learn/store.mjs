/**
 * The brain as the kit side sees it (plan 046): reads every collection, writes the kit's own four (`issues`, `proposals`,
 * `autonomy`, `cursor`) with the reader user once the Human gave it INSERT/UPDATE on them (docs/agent/kit-brain.md).
 * The connection string comes from KIT_BRAIN_READER_URI; `--driver <module.mjs>` loads a stub (tests): no test opens a network.
 */
import { loadDriver } from '../../../core/scripts/lib/brain-doc.mjs'

export const DB_NAME = 'kitbrain'
export const EVIDENCE = ['runs', 'plans', 'events', 'grades', 'toil', 'lessonsIn']
export const KIT_OWNED = ['issues', 'proposals', 'autonomy', 'cursor']

/** { all(name), put(name, doc), close() } over the driver. A write is an upsert by `_id`. */
export async function openStore({ uri, driverPath }) {
  const MongoClient = await loadDriver({ driverPath })
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 })
  await client.connect()
  const db = client.db(DB_NAME)
  return {
    all: (name) => db.collection(name).find({}).toArray(),
    put: async (name, doc) => {
      if (!KIT_OWNED.includes(name)) throw new Error(`the kit never writes ${name}`)
      await db.collection(name).replaceOne({ _id: doc._id }, doc, { upsert: true })
    },
    close: () => Promise.resolve(client.close?.()).catch(() => {}),
  }
}

/** The same interface over plain arrays (unit tests of the lib). `failOn` = a collection whose writes throw. */
export function memoryStore(data = {}, { failOn = null } = {}) {
  const d = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]))
  return {
    data: d,
    all: async (name) => JSON.parse(JSON.stringify(d[name] ?? [])),
    put: async (name, doc) => {
      if (name === failOn) throw new Error(`write to ${name} failed`)
      d[name] ??= []
      const at = d[name].findIndex((x) => x._id === doc._id)
      if (at === -1) d[name].push(JSON.parse(JSON.stringify(doc)))
      else d[name][at] = JSON.parse(JSON.stringify(doc))
    },
    close: async () => {},
  }
}
