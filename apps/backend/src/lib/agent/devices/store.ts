import { ObjectId } from 'mongodb'

import { db } from '@/lib/db'

import type { Collection } from 'mongodb'

export type AgentDeviceBoxState = 'creating' | 'running' | 'paused' | 'stopped' | 'error'

/** A cloud machine Nuphos created for this device; absent for a person's own computer. */
export type AgentDeviceBox = {
  provider: 'instabox'
  sandboxId: string
  state: AgentDeviceBoxState
  /** Why `state` is `error`, for the person who created it. */
  error?: string
  updatedAt: Date
}

export type AgentDevice = {
  userId: string
  deviceId: string
  label: string
  platform: string
  /** The machine's model as the OS names it, e.g. "MacBook Pro" or "Mac mini". */
  model?: string
  allowLocalExec: boolean
  box?: AgentDeviceBox
  /** sha256 of the credential a join token issued; absent for devices signed in as their owner. */
  credentialHash?: string
  credentialIssuedAt?: Date
  createdAt: Date
  updatedAt: Date
}

export type AgentDeviceRegistration = Pick<
  AgentDevice,
  'deviceId' | 'label' | 'platform' | 'model' | 'allowLocalExec'
>

const agentDevices = (): Collection<AgentDevice> => db().collection<AgentDevice>('agent_devices')

export async function setupAgentDeviceIndexes(): Promise<void> {
  const collection = agentDevices()

  await collection.createIndex(
    { userId: 1, deviceId: 1 },
    { unique: true, name: 'agent_device_user_device_unique' },
  )
  await collection.createIndex(
    { credentialHash: 1 },
    {
      unique: true,
      partialFilterExpression: { credentialHash: { $exists: true } },
      name: 'agent_device_credential_unique',
    },
  )
}

export async function upsertAgentDevice(
  userId: string,
  device: AgentDeviceRegistration,
): Promise<void> {
  const now = new Date()

  await agentDevices().updateOne(
    { userId, deviceId: device.deviceId },
    { $set: { ...device, userId, updatedAt: now }, $setOnInsert: { createdAt: now } },
    { upsert: true },
  )
}

export async function renameAgentDevice(userId: string, deviceId: string, label: string): Promise<boolean> {
  const result = await agentDevices().updateOne({ userId, deviceId }, { $set: { label, updatedAt: new Date() } })

  return result.matchedCount === 1
}

/** A joined device is always new, so a join token can never take over an existing one. */
export async function insertJoinedAgentDevice(
  userId: string,
  device: AgentDeviceRegistration,
  credentialHash: string,
): Promise<void> {
  const now = new Date()

  await agentDevices().insertOne({
    ...device,
    userId,
    credentialHash,
    credentialIssuedAt: now,
    createdAt: now,
    updatedAt: now,
  })
}

/** A Box's device row exists from the moment the machine is ordered, so the UI can show it. */
export async function insertBoxAgentDevice(
  userId: string,
  device: AgentDeviceRegistration & { box: AgentDeviceBox },
): Promise<void> {
  const now = new Date()

  await agentDevices().insertOne({ ...device, userId, createdAt: now, updatedAt: now })
}

/**
 * The join token made for a Box claims that Box's row, and nothing else: the row
 * must still have no credential, so a token can never take over a device in use.
 */
export async function claimBoxAgentDevice(
  userId: string,
  deviceId: string,
  platform: string,
  credentialHash: string,
): Promise<boolean> {
  const now = new Date()
  const result = await agentDevices().updateOne(
    { userId, deviceId, box: { $exists: true }, credentialHash: { $exists: false } },
    {
      $set: {
        platform,
        credentialHash,
        credentialIssuedAt: now,
        'box.state': 'running',
        'box.updatedAt': now,
        updatedAt: now,
      },
      $unset: { 'box.error': '' },
    },
  )

  return result.matchedCount > 0
}

export async function findAgentDeviceByCredentialHash(
  credentialHash: string,
): Promise<AgentDevice | null> {
  return agentDevices().findOne({ credentialHash })
}

export async function revokeAgentDeviceCredential(
  userId: string,
  deviceId: string,
): Promise<boolean> {
  const result = await agentDevices().updateOne(
    { userId, deviceId, credentialHash: { $exists: true } },
    { $unset: { credentialHash: '' }, $set: { updatedAt: new Date() } },
  )

  return result.modifiedCount > 0
}

export async function getAgentDevice(
  userId: string,
  deviceId: string,
): Promise<AgentDevice | null> {
  return agentDevices().findOne({ userId, deviceId })
}

export async function listAgentDevicesForUser(userId: string): Promise<AgentDevice[]> {
  return agentDevices().find({ userId }).toArray()
}

export async function setAgentDeviceBoxState(
  userId: string,
  deviceId: string,
  state: AgentDeviceBoxState,
  error?: string,
): Promise<void> {
  const now = new Date()

  await agentDevices().updateOne(
    { userId, deviceId, box: { $exists: true } },
    {
      $set: {
        'box.state': state,
        'box.updatedAt': now,
        updatedAt: now,
        ...(error ? { 'box.error': error } : {}),
      },
      ...(error ? {} : { $unset: { 'box.error': '' } }),
    },
  )
}

export async function setAgentDeviceSandbox(userId: string, deviceId: string, sandboxId: string): Promise<void> {
  await agentDevices().updateOne({ userId, deviceId }, { $set: { 'box.sandboxId': sandboxId, updatedAt: new Date() } })
}

export async function deleteAgentDevice(userId: string, deviceId: string): Promise<boolean> {
  const result = await agentDevices().deleteOne({ userId, deviceId })

  return result.deletedCount > 0
}

type TeamMembershipDoc = {
  members: { userId: ObjectId; deletedAt?: Date }[]
}

/** Local agents and local exec follow their owner into any team they currently belong to. */
export async function isActiveTeamMember(userId: string, teamId: string): Promise<boolean> {
  if (!ObjectId.isValid(userId) || !ObjectId.isValid(teamId)) return false
  const userObjectId = new ObjectId(userId)
  const team = await db()
    .collection<TeamMembershipDoc>('teams')
    .findOne(
      { _id: new ObjectId(teamId), deletedAt: { $exists: false } },
      { projection: { members: 1 } },
    )

  return Boolean(team?.members.some((m) => m.userId.equals(userObjectId) && !m.deletedAt))
}
