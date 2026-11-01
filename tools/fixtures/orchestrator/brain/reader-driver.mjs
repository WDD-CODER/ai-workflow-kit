// A stand-in for the `mongodb` driver on the read side (tools/brain-query.mjs --driver <this file>): the collections come
// from the JSON file named by KIT_STUB_DATA ({ runs: [], plans: [], grades: [], events: [] }). No network.
import { readFileSync } from 'node:fs'

export class MongoClient {
  constructor(uri) {
    this.uri = uri
  }

  async connect() {}

  db() {
    const data = JSON.parse(readFileSync(process.env.KIT_STUB_DATA, 'utf8'))
    return { collection: (c) => ({ find: () => ({ toArray: async () => data[c] ?? [] }) }) }
  }

  async close() {}
}
