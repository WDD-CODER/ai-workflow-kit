// A stand-in for the `mongodb` driver for /kit-learn (tools/kit-learn.mjs --driver <this file>): no test opens a network
// connection and none needs MongoDB. The collections live in the JSON file named by KIT_STUB_DATA ({ runs: [], issues: [], … });
// a write is saved back to it, so a test reads what the tool wrote.
//   KIT_STUB_FAIL_ON=<collection>   every write to that collection throws "write denied"
//   KIT_STUB_LOG=<file>             one JSON line per call
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'

const file = () => process.env.KIT_STUB_DATA
const read = () => JSON.parse(readFileSync(file(), 'utf8'))
const log = (o) => {
  if (process.env.KIT_STUB_LOG) appendFileSync(process.env.KIT_STUB_LOG, `${JSON.stringify(o)}\n`)
}
const matches = (doc, filter) => Object.entries(filter ?? {}).every(([k, v]) => doc[k] === v)

export class MongoClient {
  constructor(uri) {
    this.uri = uri
  }

  async connect() {
    log({ op: 'connect' })
  }

  db(name) {
    return {
      collection: (c) => ({
        find: (filter) => ({
          toArray: async () => {
            log({ op: 'find', db: name, collection: c })
            return (read()[c] ?? []).filter((d) => matches(d, filter))
          },
        }),
        replaceOne: async (filter, doc, opts) => {
          log({ op: 'replaceOne', db: name, collection: c, id: doc._id, opts })
          if (process.env.KIT_STUB_FAIL_ON === c) throw new Error('write denied')
          const data = read()
          data[c] ??= []
          const at = data[c].findIndex((d) => matches(d, filter))
          if (at !== -1) data[c][at] = doc
          else if (opts?.upsert) data[c].push(doc)
          writeFileSync(file(), JSON.stringify(data, null, 2))
        },
      }),
    }
  }

  async close() {
    log({ op: 'close' })
  }
}
