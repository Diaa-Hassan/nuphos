import { writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import path from 'node:path'

import type { SocketEvent, SocketLike } from './tunnel-client.ts'
import type { Socket } from 'node:net'

type Listener = (event: SocketEvent) => void

/** Xvnc for display :N listens on this port plus N (desktop-session.mjs). */
const VNC_BASE_PORT = 5900
/** The computer-use proxy forgets a human owner 30 s after the last renewal. */
const CONTROL_RENEW_MS = 20_000

/**
 * One viewer of one session's desktop, multiplexed on the device tunnel like
 * the other streams. The first frame names the display and the viewer; from
 * then on frames are RFB bytes in base64 both ways, except a control frame
 * from the viewer, which hands the desktop to them or back to the agent: while
 * a human holds it, that display's computer-use proxy refuses input tools. The
 * stream closing hands it back.
 */
export class VncStream implements SocketLike {
  readyState = 0
  private readonly listeners = new Map<string, Set<Listener>>()
  private socket: Socket | undefined
  /** The display's control file, once the display is known. */
  private control = ''
  private viewer = ''
  private renew: ReturnType<typeof setInterval> | undefined
  private readonly pool: string
  private readonly port: (display: number) => number

  constructor(pool: string, port = (display: number) => VNC_BASE_PORT + display) {
    this.pool = pool
    this.port = port
    queueMicrotask(() => {
      if (this.readyState !== 0) return
      this.readyState = 1
      this.emit('open', {})
    })
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>()

    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  send(data: string): void {
    if (this.readyState !== 1) return
    if (!data.startsWith('{')) {
      this.socket?.write(Buffer.from(data, 'base64'))

      return
    }
    try {
      const frame = JSON.parse(data) as {
        t?: string
        display?: number
        viewer?: string
        owner?: string
      }
      const { display } = frame

      if (frame.t === 'open' && !this.socket && display !== undefined && Number.isInteger(display))
        this.open(display, frame.viewer ?? '')
      else if (frame.t === 'control' && this.control) this.handOver(frame.owner === 'human')
      else throw new Error('Invalid desktop frame')
    } catch {
      this.close()
    }
  }

  private open(display: number, viewer: string): void {
    this.viewer = viewer.replace(/[^\w-]/gu, '')
    this.control = path.join(this.pool, `${String(display)}.xdg`, 'instabox-control')
    const socket = connect(this.port(display), '127.0.0.1')

    this.socket = socket
    socket.on('data', (chunk: Buffer) => this.emit('message', { data: chunk.toString('base64') }))
    socket.on('close', () => this.close())
    socket.on('error', () => this.close())
  }

  /** The lock the proxy reads: a human owner must be renewed; the agent needs no entry. */
  private handOver(toHuman: boolean): void {
    clearInterval(this.renew)
    this.renew = undefined
    const write = () => {
      try {
        writeFileSync(
          this.control,
          toHuman ? `human ${this.viewer} ${String(Math.floor(Date.now() / 1000))}\n` : 'agent\n',
        )
      } catch {
        // The desktop is gone; the stream ends with its socket.
      }
    }

    write()
    if (toHuman) this.renew = setInterval(write, CONTROL_RENEW_MS)
  }

  close(): void {
    if (this.readyState === 3) return
    this.readyState = 3
    if (this.renew) this.handOver(false)
    this.socket?.destroy()
    this.emit('close', { code: 1000 })
    this.listeners.clear()
  }

  private emit(type: string, event: SocketEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}
