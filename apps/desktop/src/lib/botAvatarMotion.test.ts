import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { withBotAvatarMotion } from './botAvatarMotion.ts'
import { BOT_AVATARS } from './botAvatars.ts'

function shipped(file: string): string {
  return readFileSync(new URL(`../../public/bot-avatars/${file}`, import.meta.url), 'utf8')
}

test('every character marks one body and two eyes for the idle loop to move', () => {
  for (const file of BOT_AVATARS) {
    const svg = shipped(file)

    assert.equal(svg.match(/<g class="bot-body">/g)?.length, 1, file)
    assert.equal(svg.match(/<g class="bot-eye">/g)?.length, 2, file)
    assert.doesNotMatch(svg, /<style/, `${file} stays still until the app animates it`)
  }
})

test('the animated copy adds one style block and starts each character at its own point', () => {
  const delays = new Set<string>()

  for (const file of BOT_AVATARS) {
    const svg = shipped(file)
    const animated = withBotAvatarMotion(svg, file)

    assert.equal(animated.match(/<style>/g)?.length, 1, file)
    assert.match(animated, /viewBox="0 0 256 256" fill="none"><style>/, file)
    assert.equal(animated.replace(/<style>[\s\S]*<\/style>/, ''), svg, file)
    delays.add(/animation:bot-body 6s (-?[\d.]+)s/.exec(animated)?.[1] ?? '')
  }
  assert.equal(delays.size, BOT_AVATARS.length)
})

test('a hover copy plays the loop once from the start; a running copy repeats it', () => {
  for (const file of BOT_AVATARS) {
    const svg = shipped(file)
    const once = withBotAvatarMotion(svg, file, false)

    assert.match(once, /animation:bot-body 6s 0s 1}/, file)
    assert.match(once, /animation:bot-eye 6s 0s 1}/, file)
    assert.equal(once.replace(/<style>[\s\S]*<\/style>/, ''), svg, file)
    assert.match(withBotAvatarMotion(svg, file), /animation:bot-body 6s -?[\d.]+s infinite}/, file)
  }
})
