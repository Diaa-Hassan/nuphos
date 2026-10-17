// Shared wire record: run-lease cleanup and graceful shutdown feed the same adopter.
export const RUNTIME_HANDOFFS_KEY = 'atlas:agent:runtime-handoffs'

export type RuntimeHandoff = {
  teamId: string
  conversationId: string
  ownerUserId: string
  actorUserId: string
  locale: string
  at: number
  attempts?: number
  /** The running turn was a member's own message; absent means automated (team credentials). */
  humanTurn?: boolean
  /** Crash recovery must never start a fresh session or replace a newer turn. */
  abandonedStreamId?: string
}
