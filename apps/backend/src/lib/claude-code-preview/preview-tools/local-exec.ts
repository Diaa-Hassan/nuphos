// `local_exec` needs to know, per conversation, which devices are currently
// selected AND online AND opted in — that set changes turn to turn (a device
// can go offline mid-conversation), so it's resolved fresh on every MCP
// tools-list/call rather than baked into a static module like the other
// local tools. It is relayed to the owner's device, so unlike those tools it
// does not depend on the sending client's `localTools` capability.
import { wakeBox } from '@/lib/agent/devices/box-instabox'
import { getAgentDevice } from '@/lib/agent/devices/store'
import { createLocalTerminalTool } from '@/lib/agent/tools-skilled/local-terminal'
import { createLocalExecTool } from '@/lib/agent/tools-skilled/local-tools'
import { publicBackendUrl } from '@/lib/claude-code-preview/runtime-backend-url'
import { getAgentCredentialOptions } from '@/routes/agent/credential-options'
import { getAgentCredentialAccess } from '@/routes/agent-sessions/shared'

import { toolModuleFromAiSdkTools } from './ai-sdk-adapter'

import type { PreviewToolContext, PreviewToolModule } from '../preview-tool-context'
import type { LocalExecDevice } from '@/lib/agent/tools-skilled/local-tools'
import type { AgentRef } from '@/lib/agents/identity'

export async function resolveAvailableLocalExecDevices(
  ctx: PreviewToolContext,
): Promise<LocalExecDevice[]> {
  const agent: AgentRef = {
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    ...(ctx.conversationOwnerUserId
      ? { conversationOwnerUserId: ctx.conversationOwnerUserId }
      : {}),
  }
  const [access, options] = await Promise.all([
    getAgentCredentialAccess(agent, ctx.teamId),
    getAgentCredentialOptions(ctx.teamId, ctx.userId),
  ])
  const selected = new Set(access.deviceIds)
  const chosen = options.devices.filter((device) => selected.has(device.deviceId))

  // A selected Box that is paused is woken before the turn sees it as offline.
  if (chosen.some((device) => !device.available)) {
    const woke = await wakeSelectedBoxes(
      ctx.userId,
      chosen.filter((d) => !d.available).map((d) => d.deviceId),
    )

    if (woke) return resolveAvailableLocalExecDevices(ctx)
  }

  return chosen
    .filter((device) => device.available)
    .map((device) => ({ deviceId: device.deviceId, label: device.label }))
}

async function wakeSelectedBoxes(userId: string, deviceIds: string[]): Promise<boolean> {
  const backendUrl = publicBackendUrl()

  if (!backendUrl) return false
  const results = await Promise.all(
    deviceIds.map(async (deviceId) => {
      const device = await getAgentDevice(userId, deviceId)

      return device ? wakeBox(device, backendUrl).catch(() => false) : false
    }),
  )

  return results.some(Boolean)
}

export async function localExecToolModule(ctx: PreviewToolContext): Promise<PreviewToolModule> {
  const devices = await resolveAvailableLocalExecDevices(ctx)

  return toolModuleFromAiSdkTools({
    local_terminal: createLocalTerminalTool(devices, {
      userId: ctx.userId,
      conversationOwnerUserId: ctx.conversationOwnerUserId,
      teamId: ctx.teamId,
      sessionId: ctx.sessionId,
      origin: ctx.turnOrigin ?? 'user',
    }),
    local_exec: createLocalExecTool(devices, {
      userId: ctx.userId,
      ...(ctx.conversationOwnerUserId
        ? { conversationOwnerUserId: ctx.conversationOwnerUserId }
        : {}),
      teamId: ctx.teamId,
      sessionId: ctx.sessionId,
      origin: ctx.turnOrigin ?? 'user',
    }),
  })
}
