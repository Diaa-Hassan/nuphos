import { config } from '@/config'

import { exchangeGithubCode, getGithubUser, githubAuthorizeUrl, githubOAuthClient } from './github'
import {
  exchangeGoogleCode,
  getGoogleUser,
  googleAuthorizeUrl,
  googleOAuthClient,
  isGoogleProvider,
} from './google'

import type { PersonalCredentialProvider } from '@/models'

type AuthorizeArgs = { clientId: string; redirectUri: string; state: string; codeChallenge: string }

/** GitHub and Google connect with PKCE; Linear does not. */
export function pkceFlow(provider: PersonalCredentialProvider) {
  if (provider === 'github') {
    return {
      client: githubOAuthClient(),
      key: config.byos.github.encryptionKey,
      authorizeUrl: githubAuthorizeUrl,
      exchange: exchangeGithubCode,
      user: getGithubUser,
    }
  }

  return isGoogleProvider(provider)
    ? {
        client: googleOAuthClient(),
        key: config.byos.linear.encryptionKey,
        authorizeUrl: (args: AuthorizeArgs) => googleAuthorizeUrl({ ...args, provider }),
        exchange: exchangeGoogleCode,
        user: getGoogleUser,
      }
    : null
}
