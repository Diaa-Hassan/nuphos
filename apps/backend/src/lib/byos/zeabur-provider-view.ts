import type { ZeaburProviderBinding } from '@/models'

type ProviderViewBinding = Pick<ZeaburProviderBinding, 'id' | 'createdAt'> & {
  identities?: ZeaburProviderBinding['identities']
}

// Different tokens can expose the same identity. Public connections address it
// by zeaburId; retain the first binding to match credential lookup, without
// changing or discarding stored credentials.
export function publicZeaburProviders(bindings: ProviderViewBinding[]) {
  const seen = new Set<string>()

  return bindings.flatMap((binding) =>
    (binding.identities ?? []).flatMap((identity) => {
      if (seen.has(identity.zeaburId)) return []
      seen.add(identity.zeaburId)

      return [
        {
          providerId: binding.id.toHexString(),
          zeaburId: identity.zeaburId,
          kind: identity.kind,
          name: identity.name,
          createdAt: binding.createdAt,
        },
      ]
    }),
  )
}
