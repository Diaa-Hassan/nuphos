import { readableByFilter } from './access'
import { agentConversations, escapeRegExp } from './shared'

import type { AgentConversation } from './shared'

export type ConversationsScope = 'mine' | 'team' | 'shared'
export type ConversationsArchivedFilter = 'exclude' | 'only'
export type ConversationsSort = 'activity' | 'created' | 'archived'

const CONVERSATION_SORT_FIELDS = {
  activity: 'lastActiveAt',
  created: 'createdAt',
  archived: 'archivedAt',
} as const satisfies Record<ConversationsSort, keyof AgentConversation>

/**
 * teamId is required, and deliberately so: every listing is a question about
 * one team. It used to be optional, and a caller that failed to supply one got
 * the viewer's chats from every team they belong to — a plausible-looking list
 * that silently crossed the team boundary the caller thought it was inside.
 * There is no "all my teams" feed; ask per team.
 */
export async function getConversations(
  viewerUserId: string,
  options: {
    teamId: string
    limit?: number
    cursor?: string
    scope?: ConversationsScope
    /** Restrict to one team member's conversations, for the Chats reader's
     *  member filter. Only meaningful in team scope, where every member's
     *  conversations are already visible. */
    ownerId?: string
    search?: string
    /** Sort newest-first by recent activity (default), creation time, or
     *  archive time — the last lists archived conversations only. */
    sort?: ConversationsSort
    // Omitted = archived and unarchived both list (existing consumers keep
    // seeing everything); 'exclude' powers the sidebar, 'only' the archive.
    archived?: ConversationsArchivedFilter
    /**
     * A trigger's run history. Omitted means the other side of the same coin:
     * Chats, which excludes every trigger-stamped conversation — a run belongs
     * to its Trigger, not to the chat list. An empty array is a Watch group
     * with no partitions yet, and matches nothing rather than degrading into
     * the unfiltered list.
     *
     * Conversations from before the stamp existed carry no `metadata.trigger`,
     * so they stay in Chats. There is nothing to attribute them to, and
     * hiding them would strand them in a Runs list they can never reach.
     */
    triggerIds?: string[]
    parentSessionId?: string // Only threads nested under this conversation: its sub-agents.
    /**
     * The sidebar's thread tree, one level per request: with `parentSessionId`
     * the threads under it, otherwise only rows that are not nested under a
     * listed conversation. A search lists every match, nested or not. Rows
     * carry `threadCount`, so a client can offer to expand them.
     */
    threads?: boolean
    sessionIds?: string[] // Exactly these rows, e.g. pinned chats.
  },
): Promise<{
  conversations: (AgentConversation & { threadCount?: number })[]
  nextCursor: string | null
  hasMore: boolean
}> {
  if (!options.teamId) throw new Error('getConversations requires a teamId')
  const limit = options.limit ?? 20
  // Scoping rules:
  //   'mine'   → only the viewer's chats within that team (default — what
  //              "Recent" intuitively means to the viewer)
  //   'team'   → every team member's chats (old default; opt-in now)
  //   'shared' → chats the viewer joined but does not own. The complement of
  //              'mine' within what the sidebar shows, so the two lists
  //              together never repeat a conversation.
  const scope: ConversationsScope = options.scope ?? 'mine'
  const sortField = CONVERSATION_SORT_FIELDS[options.sort ?? 'activity']
  const base: Record<string, unknown> = {
    teamId: options.teamId,
    // Kept apart from the search $or below, which would otherwise replace it.
    $and: [readableByFilter(viewerUserId)],
    'metadata.trigger.id': options.triggerIds ? { $in: options.triggerIds } : { $exists: false },
  }

  if (options.archived === 'only' || options.sort === 'archived') {
    base.archivedAt = { $exists: true }
  } else if (options.archived === 'exclude') {
    base.archivedAt = { $exists: false }
  }
  const query: Record<string, unknown> = { ...base }

  if (scope === 'mine') query.userId = viewerUserId
  if (scope === 'shared') {
    query.participantIds = viewerUserId
    query.userId = { $ne: viewerUserId }
  }

  // Narrowing team scope to one member reads the same as 'mine' with someone
  // else's id, limited like every scope to what the viewer may read.
  if (scope === 'team' && options.ownerId) query.userId = options.ownerId
  // What a thread may nest under: anything the same listing shows, which for
  // the personal lists is the viewer's own chats and the ones shared with them.
  const listed =
    scope === 'team'
      ? { ...base, ...(options.ownerId ? { userId: options.ownerId } : {}) }
      : {
          ...base,
          $and: [
            ...(base.$and as unknown[]),
            { $or: [{ userId: viewerUserId }, { participantIds: viewerUserId }] },
          ],
        }
  const parentSessionId = options.parentSessionId
  // A parent's threads are the listed ones under it, whoever owns them.
  const filter = options.threads && parentSessionId ? { ...listed } : query

  if (parentSessionId) filter.parentSessionId = parentSessionId
  if (options.sessionIds) filter.sessionId = { $in: options.sessionIds }
  const search = options.search?.trim()

  if (search) {
    // Substring match, not full-text: history search targets short titles /
    // first messages, where regex is predictable. The user/team index prefix
    // keeps the scan bounded to the viewer's own documents.
    const pattern = new RegExp(escapeRegExp(search), 'i')

    filter.$or = [{ title: pattern }, { firstMessage: pattern }]
  }
  if (options.cursor) {
    filter[sortField] = {
      ...(filter[sortField] as Record<string, unknown> | undefined),
      $lt: new Date(options.cursor),
    }
  }
  const sort = { [sortField]: -1 as const }
  const conversations =
    options.threads && !parentSessionId && !search
      ? await topLevelRows(filter, listed, sort, limit + 1)
      : await agentConversations()
          .find(filter)
          .sort(sort)
          .limit(limit + 1)
          .toArray()

  const hasMore = conversations.length > limit

  if (hasMore) conversations.pop()

  const last = conversations[conversations.length - 1]
  const nextCursor = hasMore ? (last?.[sortField]?.toISOString() ?? null) : null

  return {
    conversations: options.threads ? await withThreadCounts(conversations, listed) : conversations,
    nextCursor,
    hasMore,
  }
}

/**
 * Rows not nested under a listed conversation — the desktop sidebar's rule. A
 * thread whose parent the listing leaves out (archived, a trigger run, not
 * shared with the viewer) stays top-level instead of disappearing.
 */
async function topLevelRows(
  filter: Record<string, unknown>,
  listed: Record<string, unknown>,
  sort: Record<string, -1>,
  limit: number,
): Promise<AgentConversation[]> {
  return await agentConversations()
    .aggregate<AgentConversation>([
      { $match: filter },
      { $sort: sort },
      {
        $lookup: {
          from: agentConversations().collectionName,
          localField: 'parentSessionId',
          foreignField: 'sessionId',
          pipeline: [{ $match: listed }, { $project: { _id: 1 } }],
          as: 'listedParent',
        },
      },
      { $match: { listedParent: { $size: 0 } } },
      { $limit: limit },
      { $project: { listedParent: 0 } },
    ])
    .toArray()
}

/** How many listed threads sit directly under each row. */
async function withThreadCounts(
  rows: AgentConversation[],
  listed: Record<string, unknown>,
): Promise<(AgentConversation & { threadCount: number })[]> {
  const counts =
    rows.length === 0
      ? []
      : await agentConversations()
          .aggregate<{ _id: string; count: number }>([
            { $match: { ...listed, parentSessionId: { $in: rows.map((row) => row.sessionId) } } },
            { $group: { _id: '$parentSessionId', count: { $sum: 1 } } },
          ])
          .toArray()
  const byParent = new Map(counts.map((row) => [row._id, row.count]))

  return rows.map((row) => ({ ...row, threadCount: byParent.get(row.sessionId) ?? 0 }))
}
