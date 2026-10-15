import { Monitor } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { PageMeta } from '../app/pageMeta'

/** Dedicated remote desktop surface. The URL is issued by the Box API. */
export function DesktopView({ url }: { url?: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const validUrl = Boolean(url && /^https?:\/\//iu.test(url))

  useEffect(() => {
    const host = hostRef.current

    if (!host || !url || !validUrl) return
    const view = document.createElement('webview')

    view.setAttribute('src', url)
    view.setAttribute('partition', 'persist:browser')
    view.setAttribute('webpreferences', 'sandbox=yes,contextIsolation=yes')
    view.style.cssText = 'width:100%;height:100%;display:flex'
    const onFail = (event: Electron.DidFailLoadEvent) => {
      if (event.isMainFrame && event.errorCode !== -3) setError(event.errorDescription)
    }
    const onStart = () => setError(null)

    view.addEventListener('did-fail-load', onFail)
    view.addEventListener('did-start-loading', onStart)
    host.appendChild(view)

    return () => {
      view.removeEventListener('did-fail-load', onFail)
      view.removeEventListener('did-start-loading', onStart)
      view.remove()
    }
  }, [url, validUrl])

  return (
    <PageMeta pageKey="team.desktop" title="Desktop" icon={<Monitor className="h-3.5 w-3.5" />}>
      <div className="flex h-full min-h-0 w-full flex-col">
        {error && (
          <p role="alert" className="px-3 py-2 text-sm text-error">
            {error}
          </p>
        )}
        {!validUrl && (
          <p role="status" className="p-4 text-sm text-secondary">
            {url
              ? 'This desktop address is invalid. Reopen the desktop from Agents.'
              : 'Open a running Box’s desktop from Agents.'}
          </p>
        )}
        <div ref={hostRef} className="min-h-0 flex-1" />
      </div>
    </PageMeta>
  )
}
