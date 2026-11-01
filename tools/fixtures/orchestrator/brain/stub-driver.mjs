// A stand-in for the `mongodb` driver (scripts/brain.mjs --driver <this file>): no test opens a network connection.
// Behaviour comes from KIT_STUB_MODE; every call is appended to the file named by KIT_STUB_LOG (one JSON line each).
//   ok (default)  insertMany/insertOne succeed; find is denied unless KIT_STUB_CAN_READ=1
//   throw         connect() fails with "connection refused"
//   dup           insertMany fails with a duplicate-key error; insertOne of an _id in KIT_STUB_DUP (comma list) fails with E11000
//   hang          connect() never answers
//   spin          loading this module never ends (a blocked event loop: only a kill stops it)
import { appendFileSync } from 'node:fs'

const log = (o) => {
  if (process.env.KIT_STUB_LOG) appendFileSync(process.env.KIT_STUB_LOG, `${JSON.stringify(o)}\n`)
}
const mode = process.env.KIT_STUB_MODE || 'ok'
if (mode === 'spin') for (;;);

export class MongoClient {
  constructor(uri, opts) {
    log({ op: 'new', uri, opts })
  }

  async connect() {
    log({ op: 'connect' })
    if (mode === 'throw') throw new Error('connection refused\nsecond line')
    if (mode === 'hang') await new Promise(() => {})
  }

  db(name) {
    return {
      collection: (c) => ({
        insertMany: async (docs, opts) => {
          log({ op: 'insertMany', db: name, collection: c, ids: docs.map((d) => d._id), opts })
          if (mode === 'dup') throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 })
        },
        insertOne: async (doc) => {
          log({ op: 'insertOne', db: name, collection: c, id: doc._id })
          if (mode === 'dup' && (process.env.KIT_STUB_DUP || '').split(',').includes(doc._id)) throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 })
        },
        find: () => ({
          limit: () => ({
            toArray: async () => {
              log({ op: 'find', collection: c })
              if (process.env.KIT_STUB_CAN_READ !== '1') throw new Error('not authorized on kitbrain to execute command { find }')
              return []
            },
          }),
        }),
      }),
    }
  }

  async close() {
    log({ op: 'close' })
  }
}
