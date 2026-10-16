/// One row of the Agent page's thread tree.
struct NestedConversation: Identifiable, Equatable {
    let conversation: AgentConversation
    /// Per level, whether a later sibling at that level still follows this row.
    let trail: [Bool]
    /// Every thread under this row, at any depth.
    let threads: Int
    /// Everything under a folded row, so the row can stand in for it.
    let hidden: [AgentConversation]

    var hasChildren: Bool { threads > 0 }

    var id: String { conversation.sessionId }
    var depth: Int { trail.count }
}

/// The desktop sidebar's `nestItems`: agent-opened threads follow the
/// conversation that opened them, one level deeper, siblings in list order.
enum ConversationNesting {
    /// A row is top-level when its parent is not listed, or when it is pinned
    /// and its parent is not (it stays with the pins). Rows under a folded
    /// parent are left out.
    static func nest(
        _ rows: [AgentConversation], folded: Set<String> = [], pinned: Set<String> = []
    ) -> [NestedConversation] {
        let listed = Set(rows.map(\.sessionId))
        let parent: (AgentConversation) -> String? = { row in
            row.parentSessionId.flatMap {
                listed.contains($0) && (!pinned.contains(row.sessionId) || pinned.contains($0)) ? $0 : nil
            }
        }
        var children: [String: [AgentConversation]] = [:]
        for row in rows { if let id = parent(row) { children[id, default: []].append(row) } }
        func below(_ id: String) -> [AgentConversation] {
            (children[id] ?? []).flatMap { [$0] + below($0.sessionId) }
        }
        var nested: [NestedConversation] = []
        func visit(_ row: AgentConversation, _ trail: [Bool]) {
            let kids = children[row.sessionId] ?? []
            let all = below(row.sessionId)
            let isFolded = !kids.isEmpty && folded.contains(row.sessionId)
            nested.append(.init(conversation: row, trail: trail, threads: row.threadCount ?? all.count, hidden: isFolded ? all : []))
            if isFolded { return }
            for (index, kid) in kids.enumerated() { visit(kid, trail + [index < kids.count - 1]) }
        }
        for row in rows where parent(row) == nil { visit(row, []) }
        return nested
    }

    /// The one-level thread list: top-level rows, and under each expanded row
    /// the threads loaded for it. A collapsed row keeps its server
    /// `threadCount`, so it can offer to expand without loading them.
    static func tree(
        _ top: [AgentConversation], threads: [String: [AgentConversation]],
        expanded: Set<String>, pinned: Set<String> = []
    ) -> [NestedConversation] {
        var seen = Set<String>()
        var rows: [AgentConversation] = []
        func add(_ row: AgentConversation) {
            guard seen.insert(row.sessionId).inserted else { return }
            rows.append(row)
            if expanded.contains(row.sessionId) { (threads[row.sessionId] ?? []).forEach(add) }
        }
        top.forEach(add)
        return nest(rows, folded: Set(rows.map(\.sessionId)).subtracting(expanded), pinned: pinned)
    }
}
