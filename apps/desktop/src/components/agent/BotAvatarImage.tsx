import { useReducedMotion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

import {
  BOT_AVATAR_LOOP_MS,
  loopingBotAvatarUrl,
  playOnceBotAvatarUrl,
  readyLoopingBotAvatarUrl,
} from '../../lib/botAvatarMotion'

import type { BotAvatarFile } from '../../lib/botAvatars'
import type React from 'react'

/**
 * One bot avatar character, still by default. Pointing at it plays the idle loop once;
 * `looping` repeats it, for an agent with a running turn. Reduce motion keeps it still.
 * A still image costs nothing to paint, so a long sidebar only pays for what moves.
 */
export function BotAvatarImage({
  file,
  looping = false,
  className,
  style,
}: {
  file: BotAvatarFile
  looping?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  const reduceMotion = useReducedMotion() ?? false
  const loop = looping && !reduceMotion
  const [, setLoaded] = useState(0)
  const [once, setOnce] = useState<{ file: BotAvatarFile; url: string }>()
  const playing = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true

    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!loop || readyLoopingBotAvatarUrl(file)) return
    let current = true

    void loopingBotAvatarUrl(file).then((url) => {
      if (url && current) setLoaded((count) => count + 1)
    })

    return () => {
      current = false
    }
  }, [file, loop])

  const release = () => {
    playing.current = false
  }

  const endPlay = (url: string) => {
    release()
    URL.revokeObjectURL(url)
    if (mounted.current) setOnce((shown) => (shown?.url === url ? undefined : shown))
  }

  const playOnce = async () => {
    if (loop || reduceMotion || playing.current) return
    playing.current = true
    const url = await playOnceBotAvatarUrl(file)

    if (!url) {
      release()

      return
    }
    if (!mounted.current) {
      endPlay(url)

      return
    }
    setOnce({ file, url })
    window.setTimeout(() => endPlay(url), BOT_AVATAR_LOOP_MS)
  }

  const played = once?.file === file ? once.url : undefined
  const moving = loop ? readyLoopingBotAvatarUrl(file) : played

  return (
    <img
      src={moving ?? `/bot-avatars/${file}`}
      alt=""
      draggable={false}
      onPointerEnter={() => void playOnce()}
      className={className}
      style={style}
    />
  )
}
