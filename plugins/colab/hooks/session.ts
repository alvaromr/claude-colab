import { languageOf } from '../cli/protocol.mts'
import type { Known, Setup } from '../types'
import { resume } from './link.ts'
import { checkServer } from './server.ts'
import { type Engine, speak, T, unattended, unlinked, updateKnown, updateLink, updateSetup } from './state.ts'
import { registerTools } from './tools.ts'

let hasStarted = false

/** Run by session.start, and by the first drawing where a resumed session drew before session.start reached it. */
export async function start($: Engine) {
  hasStarted = true
  speak(
    languageOf({
      LC_ALL: await $.env.get('LC_ALL'),
      LC_MESSAGES: await $.env.get('LC_MESSAGES'),
      LANG: await $.env.get('LANG'),
    }),
  )
  // A reload ends the connect process with the old module: nothing is linked any more.
  await updateLink($, () => ({ status: 'off' }))
  await unlinked($)
  unattended($, T.serverUnknown, checkServer($)) // the pane waits for it
  const saved = (await $.store.get('setup')) as Partial<Setup> | undefined
  const servers = (await $.store.get('servers')) as Known[] | undefined

  // A setup stored by an older version may lack fields, which keep their defaults, or hold ones gone since.
  if (saved !== undefined) {
    await updateSetup($, s => ({
      name: saved.name ?? s.name,
      title: saved.title ?? s.title,
      port: saved.port ?? s.port,
    }))
  }
  if (servers !== undefined) await updateKnown($, () => servers)
  await resume($)
  await $.command.register({ name: 'colab', description: T.command, argumentHint: T.commandHint })
  await registerTools($)
}

/** For a drawing, which writes no state: a start it finds missing runs on a timer of its own. */
export function ensureStarted($: Engine) {
  if (hasStarted) return
  hasStarted = true
  const starting = () => start($).then(() => undefined)

  $.clock.after(0, () => unattended($, T.noStart, starting()))
}
