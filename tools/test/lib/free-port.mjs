// A port for a test server that nothing else holds. Port 0 hands out a port from the OS's dynamic range (49152-65535
// on Windows), the same range every outgoing connection and every other test's port 0 draws from, so under a loaded
// full suite another process could take it between the check and the server's start. This picks a random port below
// that range (20000-31999, also below Linux's 32768), checks it can be bound and that nothing answers on it, and never
// hands the same port out twice in one process.
import net from 'node:net'

const given = new Set()
const LOW = 20000
const SPAN = 12000

const bindable = (port) => new Promise((done) => {
  const s = net.createServer()
  s.once('error', () => done(false))
  s.listen(port, '127.0.0.1', () => s.close(() => done(true)))
})

const answers = (port) => new Promise((done) => {
  const s = net.connect({ port, host: '127.0.0.1' })
  s.setTimeout(500, () => { s.destroy(); done(false) })
  s.once('connect', () => { s.destroy(); done(true) })
  s.once('error', () => done(false))
})

export async function freePort() {
  for (let i = 0; i < 200; i++) {
    const port = LOW + Math.floor(Math.random() * SPAN)
    if (given.has(port)) continue
    if (!(await bindable(port)) || (await answers(port))) continue
    given.add(port)
    return port
  }
  throw new Error('freePort: no free port found in 20000-31999 after 200 tries')
}
