import { agentConversations } from './shared'

/**
 * A thread's turn is activity for the conversations it nests under: the
 * sidebar lists only top-level rows, so the parent of a busy thread sorts by
 * that activity, and idle auto-archive does not archive it out from under it.
 */
export async function touchThreadAncestors(sessionId: string, now: Date): Promise<void> {
  const [row] = await agentConversations()
    .aggregate<{ ancestors: { sessionId: string }[] }>([
      { $match: { sessionId, parentSessionId: { $exists: true } } },
      {
        $graphLookup: {
          from: agentConversations().collectionName,
          startWith: '$parentSessionId',
          connectFromField: 'parentSessionId',
          connectToField: 'sessionId',
          as: 'ancestors',
          maxDepth: 9,
        },
      },
      { $project: { 'ancestors.sessionId': 1 } },
    ])
    .toArray()
  const ids = row?.ancestors.map((ancestor) => ancestor.sessionId) ?? []

  if (ids.length === 0) return
  await agentConversations().updateMany(
    { sessionId: { $in: ids } },
    { $max: { lastActiveAt: now } },
  )
}
