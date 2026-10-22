// Skills this computer already has: the directories Claude Code and Codex read
// from. Listing them and walking one is all this module owns; reading and
// uploading a skill's files is local-skill-import.ts.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { Dirent, Stats } from 'node:fs'

export type LocalSkillSource = 'claude' | 'codex'

export type LocalSkillInfo = {
  /** `<source>/<name>` — a name can exist under both agents. */
  id: string
  name: string
  source: LocalSkillSource
  path: string
  /** First line of the SKILL.md frontmatter `description`, when it has one. */
  description: string | null
  fileCount: number
  totalBytes: number
  updatedAt: string
}

export type LocalSkillEntry = { relPath: string; size: number; mtimeMs: number }

/** The team skill store rejects anything larger, so skip it before uploading. */
export const MAX_SKILL_FILE_BYTES = 10_000_000
const MAX_FILES = 200
const MAX_DEPTH = 6
const SKIP_ENTRIES = new Set(['.git', '.DS_Store', 'node_modules'])

function skillRoots(): { source: LocalSkillSource; dir: string }[] {
  const home = os.homedir()

  return [
    { source: 'claude', dir: path.join(home, '.claude', 'skills') },
    { source: 'codex', dir: path.join(home, '.agents', 'skills') },
  ]
}

/** The `description:` of a SKILL.md, read from its leading frontmatter block. */
export function skillDescription(markdown: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(markdown)

  if (!match?.[1]) return null
  const line = match[1]
    .split(/\r?\n/u)
    .find((candidate) => /^description\s*:/iu.test(candidate))
    ?.replace(/^description\s*:/iu, '')
    .trim()
    .replace(/^['"]|['"]$/gu, '')
    .trim()

  return line ? line.slice(0, 300) : null
}

/**
 * Where a symlinked file really is, when that is a regular file inside `within`
 * (the skills directory itself). Tools such as gstack install each skill as a
 * folder of links into one shared checkout there; a link anywhere else, or to a
 * directory, is never followed.
 */
async function containedLink(full: string, within: string): Promise<Stats | null> {
  try {
    const target = await fs.realpath(full)

    if (!target.startsWith(`${within}${path.sep}`)) return null
    const stat = await fs.stat(target)

    return stat.isFile() ? stat : null
  } catch {
    return null
  }
}

/** A regular file's stat, or a contained link's target's; null for anything else. */
async function fileStat(entry: Dirent, full: string, within: string | null): Promise<Stats | null> {
  if (entry.isSymbolicLink()) return within ? containedLink(full, within) : null
  if (!entry.isFile()) return null

  // Vanished between readdir and stat: treat it as absent.
  return fs.lstat(full).catch(() => null)
}

/**
 * Every regular file under a skill directory, flattened to relative paths.
 * Directory symlinks are never followed, and a file symlink only when it points
 * at a file inside the same skills directory (see containedLink), so a link
 * cannot pull anything from elsewhere on the computer in — the same reason a
 * symlinked skill root never appears in `listLocalSkills`.
 */
export async function localSkillEntries(root: string): Promise<LocalSkillEntry[]> {
  const out: LocalSkillEntry[] = []
  const within = await fs.realpath(path.dirname(root)).catch(() => null)

  async function walk(dir: string, prefix: string, depth: number) {
    if (depth > MAX_DEPTH || out.length >= MAX_FILES) return
    let entries: Dirent[]

    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_FILES) return
      if (SKIP_ENTRIES.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        await walk(full, relPath, depth + 1)
        continue
      }
      const stat = await fileStat(entry, full, within)

      if (stat) out.push({ relPath, size: stat.size, mtimeMs: stat.mtimeMs })
    }
  }

  await walk(root, '', 0)

  // SKILL.md first: it is the file the store keys the skill on, so a partial
  // upload still leaves a listable skill rather than orphan objects.
  return out.sort((a, b) => {
    if (a.relPath === 'SKILL.md') return -1
    if (b.relPath === 'SKILL.md') return 1

    return a.relPath.localeCompare(b.relPath)
  })
}

async function describeSkill(
  source: LocalSkillSource,
  dir: string,
  name: string,
): Promise<LocalSkillInfo | null> {
  const root = path.join(dir, name)
  const markdown = await fs.readFile(path.join(root, 'SKILL.md'), 'utf8').catch(() => null)

  // Without a SKILL.md the directory is not a skill — the store keys on it too.
  if (markdown === null) return null
  const entries = await localSkillEntries(root)

  return {
    id: `${source}/${name}`,
    name,
    source,
    path: root,
    description: skillDescription(markdown),
    fileCount: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
    updatedAt: new Date(Math.max(0, ...entries.map((entry) => entry.mtimeMs))).toISOString(),
  }
}

export async function listLocalSkills(): Promise<LocalSkillInfo[]> {
  const found = await Promise.all(
    skillRoots().map(async ({ source, dir }) => {
      const names = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
      const skills = await Promise.all(
        names
          .filter(
            (entry) => entry.isDirectory() && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(entry.name),
          )
          .map((entry) => describeSkill(source, dir, entry.name)),
      )

      return skills.filter((skill): skill is LocalSkillInfo => skill !== null)
    }),
  )

  return found.flat().sort((a, b) => a.name.localeCompare(b.name))
}
