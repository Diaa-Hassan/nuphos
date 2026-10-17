import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { previewSessionPrincipalChanged } from './agent-chat-runtime'
import { previewSessionAccess } from './credentials-mcp'

// The runtime image derives each turn's HOME from this env. Imported by path:
// it ships with the runtime, not the backend.
const SESSION_HOME = join(import.meta.dir, '../../../../runtime/image/session-home.mjs')
const { nuphosSessionHomeEnv } = (await import(SESSION_HOME)) as {
  nuphosSessionHomeEnv: (
    sessionEnv: Record<string, string>,
    runtimeEnv: Record<string, string>,
  ) => Record<string, string>
}

const runtimeHome = mkdtempSync(join(tmpdir(), 'nuphos-home-'))

afterAll(() => rmSync(runtimeHome, { recursive: true, force: true }))

function turn(humanTurn: boolean) {
  const { runtimeEnv = {} } = previewSessionAccess('conv-1', 'team-1', 'owner', 'owner', {
    backendUrl: 'https://backend.example',
    humanTurn,
  })
  const home = nuphosSessionHomeEnv(runtimeEnv, { HOME: runtimeHome, PATH: '' })

  return {
    runtime: { env: runtimeEnv },
    // Where the github and linear skills' setup scripts leave their logins.
    githubLogin: join(home.GH_CONFIG_DIR ?? '', 'hosts.yml'),
    linearLogin: join(home.HOME ?? '', '.linear', 'nuphos.env'),
  }
}

function login(path: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, 'personal')
}

describe('Personal Credential logins on disk', () => {
  test('a human -> automated -> human sequence never shows the member’s logins to the automated turn', () => {
    const human = turn(true)

    login(human.githubLogin)
    login(human.linearLogin)

    const automated = turn(false)

    // The switch reloads the session, so the runtime moves to the automated HOME.
    expect(
      previewSessionPrincipalChanged({ userId: 'owner', ...human }, 'owner', automated.runtime),
    ).toBe(true)
    expect(existsSync(automated.githubLogin)).toBe(false)
    expect(existsSync(automated.linearLogin)).toBe(false)

    const again = turn(true)

    expect(
      previewSessionPrincipalChanged({ userId: 'owner', ...automated }, 'owner', again.runtime),
    ).toBe(true)
    // The member's own turns keep their logins.
    expect(existsSync(again.githubLogin)).toBe(true)
    expect(existsSync(again.linearLogin)).toBe(true)
  })

  test('consecutive turns of the same kind keep the loaded session', () => {
    const human = turn(true)
    const automated = turn(false)

    expect(
      previewSessionPrincipalChanged({ userId: 'owner', ...human }, 'owner', turn(true).runtime),
    ).toBe(false)
    expect(
      previewSessionPrincipalChanged(
        { userId: 'owner', ...automated },
        'owner',
        turn(false).runtime,
      ),
    ).toBe(false)
  })
})
