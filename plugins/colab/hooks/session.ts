import { languageOf } from '../cli/protocol'
import type { Known, Setup } from '../types'
import { resume } from './link'
import { checkServer } from './server'
import {
  complain,
  type Engine,
  isNativeWindows,
  speak,
  standOn,
  T,
  unattended,
  unlinked,
  updateKnown,
  updateLink,
  updateSetup,
} from './state'
import { registerTools } from './tools'

/** Run by session.start, which the engine fires at each load of the mod, a reload included. */
export async function start($: Engine) {
  speak(
    languageOf({
      LC_ALL: await $.env.get('LC_ALL'),
      LC_MESSAGES: await $.env.get('LC_MESSAGES'),
      LANG: await $.env.get('LANG'),
    }),
  )
  standOn((await $.session.info()).platform)
  // On native Windows nothing runs the CLI, which stops at once there: the pane, the command and the tools say why.
  if (isNativeWindows) await complain($, T.nativeWindows)
  else await restore($)
  await $.command.register({ name: 'colab', description: T.command, argumentHint: T.commandHint })
  await registerTools($)
}

/** What a start takes up again: this machine's server, what the store kept, and the link and room asked for. */
async function restore($: Engine) {
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
}
