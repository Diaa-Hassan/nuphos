// A desktop per conversation on a Linux Box: the agents' env names the wrapper
// Claude runs as each session's `computer-use` MCP server (desktop-session.mjs),
// and a pool sized to the CPUs; a reaper frees displays whose session is gone.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REAP_EVERY_MS = 60_000

/** Returns the pool directory, or null where this computer cannot host desktops. */
export function enableDesktopPool(bundleRoot: string, dataDir: string): string | null {
  const wrapper = path.join(bundleRoot, 'desktop-session.mjs')

  if (
    process.platform !== 'linux' ||
    !existsSync(wrapper) ||
    !existsSync('/usr/local/bin/open-computer-use') ||
    !['/usr/bin/Xvnc', '/usr/local/bin/Xvnc'].some((xvnc) => existsSync(xvnc))
  )
    return null
  const pool = path.join(dataDir, 'desktops')

  process.env.NUPHOS_DESKTOP_SESSION = wrapper
  process.env.NUPHOS_DESKTOP_POOL = pool
  process.env.NUPHOS_DESKTOP_POOL_SIZE = String(os.cpus().length)
  setInterval(() => {
    spawn(process.execPath, [wrapper, 'reap', pool], { stdio: 'ignore' }).on('error', () => {})
  }, REAP_EVERY_MS).unref()

  return pool
}
