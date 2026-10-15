/** Resolve the public hostname whose ingress service targets this worktree's
 * backend port. Read the installed config instead of assuming a hostname
 * convention; named tunnel hostnames have changed over time. */
export function namedTunnelUrlFromConfig(source: string, port: number): string | null {
  let hostname: string | null = null

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    const hostnameMatch = line.match(/^- hostname:\s*(\S+)$/)

    if (hostnameMatch) {
      hostname = hostnameMatch[1] ?? null
      continue
    }
    if (line.startsWith('- ') && !line.startsWith('- hostname:')) hostname = null
    if (hostname && /^service:\s*http:\/\//.test(line) && line.includes(`:${String(port)}`)) {
      return `https://${hostname}`
    }
  }

  return null
}
