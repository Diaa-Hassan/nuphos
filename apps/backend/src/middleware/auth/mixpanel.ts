import { ObjectId } from 'mongodb'

import { canUseAllowList } from '@/lib/byos/access'
import { findMixpanelAccount } from '@/lib/byos/account'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'

import type { MixpanelAccountVariables } from '@/middleware/auth/types'
import type { MiddlewareHandler } from 'hono'

export function requireMixpanelAccount(): MiddlewareHandler<{
  Variables: MixpanelAccountVariables
}> {
  return async (c, next) => {
    const param = c.req.param('accountId')

    if (!param || !/^[a-f0-9]{24}$/i.test(param)) {
      throw new AppError(400, 'invalid_account_id', 'accountId must be a 24-character hex ObjectId')
    }
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = await findMixpanelAccount(teamId, new ObjectId(param))

    if (!binding) {
      throw new AppError(
        404,
        'mixpanel_account_not_bound',
        `Mixpanel account ${param} is not bound to this team`,
      )
    }
    c.set('mixpanelAccountId', param)
    c.set('mixpanelAccountLabel', binding.label)
    c.set('mixpanelAccess', binding.access)
    c.set('mixpanelBinding', binding)
    await next()
  }
}

export function requireMixpanelMemberAccess(): MiddlewareHandler<{
  Variables: MixpanelAccountVariables
}> {
  return async (c, next) => {
    // Admins bypass the allow-list (same rule as the Tencent/Aliyun/Volcengine
    // bindings). Mixpanel defaults to binder-only rather than every member, so
    // without this an admin couldn't administer a binding they didn't create.
    if (
      c.get('teamRole') !== 'ADMINISTRATOR' &&
      !canUseAllowList(c.get('mixpanelAccess')?.memberAllowList, c.get('userId'))
    ) {
      throw new AppError(
        403,
        'mixpanel_account_access_denied',
        'You are not allowed to use this Mixpanel account binding',
      )
    }
    await next()
  }
}
