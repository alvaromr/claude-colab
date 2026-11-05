import { type Answer, type Engine, failed, readLink, T } from './state.ts'

/** One request to this session's connect process, over its local socket. */
export async function request($: Engine, op: string, args: Record<string, unknown> = {}): Promise<Answer> {
  const current = await readLink($)

  if (current.status !== 'on') return failed(T.notLinked)
  try {
    const { text } = await $.http.fetch(`http://claude-colab/${op}`, {
      method: 'POST',
      socketPath: current.socket,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args),
    })

    return JSON.parse(text) as Answer
  } catch (caught) {
    return failed(String(caught))
  }
}
