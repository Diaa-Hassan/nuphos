import type { LocalAgentProvider, LocalRuntimeState, SleepPreferences } from './device-types.ts'

export const deviceApi = {
  deviceGetIdentity: () => window.api.deviceGetIdentity(),
  deviceSetLabel: (label: string) => window.api.deviceSetLabel(label),
  deviceListAudit: (before?: string) => window.api.deviceListAudit(before),
  localRuntimeStartClaudeLogin: () => window.api.localRuntimeStartClaudeLogin(),
  localRuntimeStartCodexLogin: () => window.api.localRuntimeStartCodexLogin(),
  localRuntimeCancelClaudeLogin: () => window.api.localRuntimeCancelClaudeLogin(),
  localRuntimeCancelCodexLogin: () => window.api.localRuntimeCancelCodexLogin(),
  localRuntimeSetSleepPreferences: (value: SleepPreferences) =>
    window.api.localRuntimeSetSleepPreferences(value),
  localRuntimeGetState: () => window.api.localRuntimeGetState(),
  onLocalRuntimeState: (cb: (state: LocalRuntimeState) => void) =>
    window.api.onLocalRuntimeState(cb),
  localRuntimeRefresh: () => window.api.localRuntimeRefresh(),
  localRuntimeUpdateAgent: (provider: LocalAgentProvider) =>
    window.api.localRuntimeUpdateAgent(provider),
  localRuntimeLatestAgentVersions: () => window.api.localRuntimeLatestAgentVersions(),
  localRuntimeOpenWorkspace: () => window.api.localRuntimeOpenWorkspace(),
  localRuntimeListActivity: (before?: string) => window.api.localRuntimeListActivity(before),
  boxListDevices: () => window.api.boxListDevices(),
  boxCreate: (teamId: string, label?: string) => window.api.boxCreate(teamId, label),
  boxPause: (deviceId: string) => window.api.boxPause(deviceId),
  boxResume: (deviceId: string) => window.api.boxResume(deviceId),
  boxDelete: (deviceId: string) => window.api.boxDelete(deviceId),
  boxUsage: (teamId: string) => window.api.boxUsage(teamId),
  boxBillingPage: (teamId: string, vcpus?: number) => window.api.boxBillingPage(teamId, vcpus),
}
