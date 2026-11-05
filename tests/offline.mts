// Loaded before the Node tests and every process they start (NODE_OPTIONS, set by test:node and the mutation command):
// a socket connects only to this machine, by loopback or by a local socket's path, so no test reaches another one,
// whatever address it is given. A connection anywhere else throws, naming where it was headed.
import net from 'node:net'

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|::1|::ffff:127(\.\d{1,3}){3})$/i
const connect = net.Socket.prototype.connect

/** Where a call of `connect` goes: a host, or undefined for a local socket's path. */
function hostOf(args: unknown[]) {
  const [first, second] = Array.isArray(args[0]) ? (args[0] as unknown[]) : args
  if (typeof first === 'number') return typeof second === 'string' ? second : 'localhost'
  if (typeof first === 'string') return undefined
  const { path, host } = (first ?? {}) as { path?: string; host?: string }
  return path ? undefined : (host ?? 'localhost')
}

net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
  const host = hostOf(args)
  if (host !== undefined && !LOOPBACK.test(host)) {
    throw new Error(`offline: the tests reach this machine alone, not ${host}`)
  }
  return Reflect.apply(connect, this, args)
} as typeof connect
