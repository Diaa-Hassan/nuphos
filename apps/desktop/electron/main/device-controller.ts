import { execFileSync } from 'node:child_process'

import { callJson } from '../agent/http.ts'
import { logLocalTool, normalizeToolError } from '../agent/local-exec.ts'

import { readDeviceIdentity, setDeviceLabel } from './device-identity.ts'

import type { DeviceIdentity } from './device-identity-core.ts'

let model: string | undefined | null = null

/** "MacBook Pro", "Mac mini"…: what the Boxes list draws this computer as. Read once. */
function machineModel(): string | undefined {
  if (model !== null) return model
  model = undefined
  if (process.platform === 'darwin') {
    try {
      const out = execFileSync('/usr/sbin/system_profiler', ['SPHardwareDataType'], {
        encoding: 'utf8',
        timeout: 5_000,
      })

      model = /Model Name:\s*(.+)/u.exec(out)?.[1]?.trim() || undefined
    } catch {
      model = undefined
    }
  }

  return model
}

// Local exec is available on every signed-in device while Desktop is open.
async function syncRegistration(identity: DeviceIdentity): Promise<void> {
  try {
    await callJson(
      'PUT',
      '/agent/devices',
      {
        deviceId: identity.deviceId,
        label: identity.label,
        platform: process.platform,
        ...(machineModel() ? { model: machineModel() } : {}),
        // Older backends still require this capability flag in registration.
        allowLocalExec: true,
      },
      10_000,
    )
  } catch (err) {
    logLocalTool('failed to sync device registration', { error: normalizeToolError(err) })
  }
}

export function syncDeviceRegistration(): Promise<void> {
  return syncRegistration(readDeviceIdentity())
}

export function getDeviceIdentity(): DeviceIdentity {
  return readDeviceIdentity()
}

export async function updateDeviceLabel(label: string): Promise<DeviceIdentity> {
  const identity = setDeviceLabel(label)

  await syncRegistration(identity)

  return identity
}

const DEVICE_AUDIT_PAGE_SIZE = 20

export function listDeviceAudit(before?: string): Promise<unknown> {
  const { deviceId } = readDeviceIdentity()
  const query = new URLSearchParams({ limit: String(DEVICE_AUDIT_PAGE_SIZE) })

  if (before) query.set('before', before)

  return callJson('GET', `/agent/devices/${encodeURIComponent(deviceId)}/audit?${query.toString()}`)
}
