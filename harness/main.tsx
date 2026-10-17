import { Archive } from 'lucide-react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { chatSidebarItem } from '../src/components/sidebar/chat-item'
import { SidebarSectionList } from '../src/components/sidebar/sections-list'

const T = 'team1'
const sel = location.hash.includes('sel')
const archive = (
  <span role="button" aria-label="Archive chat" title="Archive chat" onClick={(e) => e.stopPropagation()}
    className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-tertiary hover:text-main hover:bg-[var(--sidebar-overlay-hover)]">
    <Archive className="w-3.5 h-3.5" strokeWidth={1.8} />
  </span>
)
const now = new Date().toISOString()
const S = {
  running: { schemaVersion: 2, state: 'active', phase: 'turn', label: 'Agent: running', observedAt: now },
  bg: { schemaVersion: 2, state: 'idle', phase: 'background_tools', observedAt: now },
  error: { schemaVersion: 2, state: 'idle', phase: 'stopped', label: 'Agent stopped', observedAt: now },
} as any
const pr = [{ id: 'r1', provider: 'github', title: 'Fix sidebar', url: 'https://github.com/nuphos/nuphos/pull/1', state: 'open', repository: 'nuphos/nuphos', number: 1, linkedAt: now }]
const row = (id: string, title: string, rs?: any, unread = false, extra: any = {}, more: any = {}) =>
  chatSidebarItem({ conversation: { sessionId: id, title, linkedResources: [], ...extra } as any, teamId: T, active: sel, runtimeState: rs, unread,
    actions: more.readOnly && !extra.canManage ? undefined : archive, ...more })

const sections = [
  { title: 'Pinned', items: [row('pin', 'Pinned running', S.running)] },
  { title: 'Chats', items: [
    row('idle', 'Idle'),
    row('run', 'Running', S.running),
    row('unread', 'Unread', undefined, true),
    row('rununread', 'Running + unread', S.running, true),
    row('err', 'Needs attention', S.error),
    row('bg', 'Background tools', S.bg),
    row('bgunread', 'Background + unread', S.bg, true),
    row('res', 'Running + linked PR', S.running, false, { linkedResources: pr }),
    row('par', 'Parent', undefined),
    row('thr', 'Nested thread running', S.running, false, { parentSessionId: 'par' }),
    row('fold', 'Folded parent, unread', undefined, true),
    row('fthr', 'Hidden thread running', S.running, false, { parentSessionId: 'fold' }),
    row('cjk', '調查生產環境叢集中節點記憶體壓力過高導致的大量 Pod 被驅逐問題', S.running, true),
  ] },
  { title: 'Shared', items: [row('sh', 'Shared running', S.running, false, { canManage: false }, { readOnly: true })] },
]
const pinned = new Set(['agent-session:pin'])

createRoot(document.getElementById('root')!).render(
  <div className="sidebar-surface is-floating" style={{ position: 'relative', width: 260, padding: '8px 10px', minHeight: '100vh', boxSizing: 'border-box' }}>
    <SidebarSectionList sections={sections as any} scope={{ kind: 'team', teamId: T } as any} active="" teamView newChatActive={false}
      archivingIds={new Set()} isGroupCollapsed={(s) => s.title === 'agent-session:fold'} toggleGroup={() => {}}
      favoriteMatch={(i) => (pinned.has(i.key) ? ({} as any) : undefined)} canFavorite={(i) => i.key.startsWith('agent-session:')}
      toggleFavorite={() => {}} onItemMenu={() => {}} onSelect={() => {}} />
  </div>,
)
