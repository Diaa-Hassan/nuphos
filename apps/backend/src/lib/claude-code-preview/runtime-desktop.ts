// A conversation's own desktop on its Box, streamed to the conversation's owner:
// the client's WebSocket carries RFB bytes as base64 text frames, which the
// device tunnel relays to the host's Xvnc for that display (see the host's
// vnc-stream.ts). The first frame tells the host the display and the viewer. The
// viewer may take the desktop over with a control frame, which the host turns
// into the lock that display's computer-use proxy respects; the stream closing
// hands it back. Links carry ids only: the route is the authorization.

import { getReadableConversation } from '@/lib/agent/db'
import { parseLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { tunnelBus } from '@/lib/agent/devices/local-runtime/bus'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { DeviceRuntimeSocket } from '@/lib/agent/devices/local-runtime/socket'
import { AppError } from '@/lib/errors'

import type { DeviceRuntimeSocketDeps } from '@/lib/agent/devices/local-runtime/socket'
import type { WSEvents } from 'hono/ws'

/** One RFB frame in base64 (a framebuffer update is far below this), or a control frame. */
const MAX_FRAME_CHARS = 4 * 1024 * 1024

export type RuntimeDesktopTarget = {
  userId: string
  deviceId: string
  teamId: string
  display: number
  /** Who is watching: named in the lock when they take over, never a secret. */
  viewer: string
}

const notFound = () => new AppError(404, 'not_found', 'Conversation desktop not found')

/** The owner of the conversation, for a display the Box reports as this session's. */
export async function runtimeDesktopTarget(
  teamId: string,
  userId: string,
  sessionId: string,
  displayParam: string,
  presence = runtimePresenceStore(),
): Promise<RuntimeDesktopTarget> {
  const display = Number(displayParam)
  const conversation = await getReadableConversation(sessionId, userId, teamId)
  const ref = conversation?.runtimeId ? parseLocalRuntimeId(conversation.runtimeId) : undefined

  if (!ref || conversation?.userId !== userId || conversation.teamId !== teamId) throw notFound()
  const desktops = (await presence.get(ref.userId, ref.deviceId))?.status?.desktops ?? []

  if (!desktops.some((desktop) => desktop.display === display && desktop.sessionId === sessionId))
    throw notFound()

  return { userId: ref.userId, deviceId: ref.deviceId, teamId, display, viewer: userId }
}

/** Relays the client's frames to one `vnc` stream on the Box's tunnel and back. */
export function runtimeDesktopEvents(
  target: RuntimeDesktopTarget,
  deps: DeviceRuntimeSocketDeps = { bus: tunnelBus(), presence: runtimePresenceStore() },
): WSEvents {
  const { display, viewer, ...device } = target
  const stream = new DeviceRuntimeSocket({ ...device, purpose: 'vnc' }, deps)
  const close = () => {
    stream.close()
  }

  return {
    onOpen(_event, ws) {
      stream.addEventListener('open', () => {
        stream.send(JSON.stringify({ t: 'open', display, viewer }))
      })
      stream.addEventListener('message', ({ data }) => {
        if (typeof data === 'string') ws.send(data)
      })
      stream.addEventListener('close', () => {
        ws.close(1011, 'The desktop is gone')
      })
      void stream.connect()
    },
    onMessage(event, ws) {
      try {
        if (typeof event.data !== 'string' || event.data.length > MAX_FRAME_CHARS)
          throw new Error('Invalid desktop frame')
        stream.send(event.data)
      } catch {
        close()
        ws.close(1008, 'Invalid desktop frame')
      }
    },
    onClose: close,
    onError: close,
  }
}
