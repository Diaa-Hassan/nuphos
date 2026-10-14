import { readLocalStorage, writeLocalStorage } from '../app/localStorage.ts'

export type SessionVisit = { sessionId: string; openedAt: number }
const LIMIT = 8

export function sessionHistoryKey(userId: string, teamId: string): string {
  return `nuphos.sessionHistory.${JSON.stringify([userId, teamId])}`
}

export function parseSessionHistory(raw: string | null): SessionVisit[] {
  try {
    const entries: unknown = JSON.parse(raw ?? '[]')

    if (!Array.isArray(entries)) return []

    return entries
      .filter(
        (entry: unknown): entry is SessionVisit =>
          typeof entry === 'object' &&
          entry !== null &&
          'sessionId' in entry &&
          typeof entry.sessionId === 'string' &&
          entry.sessionId.length > 0 &&
          'openedAt' in entry &&
          typeof entry.openedAt === 'number' &&
          Number.isFinite(entry.openedAt),
      )
      .slice(0, LIMIT)
  } catch {
    return []
  }
}

export function readSessionHistory(userId: string, teamId: string): SessionVisit[] {
  return parseSessionHistory(readLocalStorage(sessionHistoryKey(userId, teamId)))
}

export function recordSessionVisit(userId: string, teamId: string, sessionId: string): void {
  const entries = readSessionHistory(userId, teamId)

  writeLocalStorage(
    sessionHistoryKey(userId, teamId),
    JSON.stringify(
      [
        { sessionId, openedAt: Date.now() },
        ...entries.filter((entry) => entry.sessionId !== sessionId),
      ].slice(0, LIMIT),
    ),
  )
}
