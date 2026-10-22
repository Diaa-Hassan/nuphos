import { navigationFromAppPath, pageLocationForNavigation } from '../../lib/appRoutes.ts'
import { externalPageLink } from '../../lib/externalPageLink.ts'
import { isAppWebUrl } from '../../lib/webBaseUrl.ts'

type LinearLinks = {
  getLinearIssue: (
    teamId: string,
    bindingId: string,
    identifier: string,
  ) => Promise<{ url: string }>
  listLinearTeams: (
    teamId: string,
    bindingId: string,
  ) => Promise<{
    teams: { id: string; url?: string | null }[]
  }>
}

// Resolve only known app routes. Native pages and unavailable resources retain
// their shareable Nuphos URL; never invent a provider workspace slug.
export async function resolveChatExternalLink(href: string, linear: LinearLinks): Promise<string> {
  const appUrl = isAppWebUrl(href.trim())

  if (!appUrl) return href.trim()
  const fallback = appUrl.toString()

  try {
    const nav = navigationFromAppPath(appUrl.pathname + appUrl.search)

    if (nav?.scope.kind !== 'team') return fallback
    // Reject unknown suffixes tolerated by the navigation parser.
    if (pageLocationForNavigation(nav).pathname !== appUrl.pathname) return fallback
    const github = externalPageLink(nav)

    if (github) return github.url
    const target = nav.linearNav

    if (nav.active !== 'team.linear' || !target || target.view === 'teams') return fallback
    const teamId = nav.scope.teamId
    const url =
      target.view === 'issue'
        ? (await linear.getLinearIssue(teamId, target.bindingId, target.identifier)).url
        : (await linear.listLinearTeams(teamId, target.bindingId)).teams.find(
            (team) => team.id === target.team.id,
          )?.url

    return url && /^https:\/\/linear\.app\//i.test(url) ? url : fallback
  } catch {
    return fallback
  }
}
