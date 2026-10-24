package ai.nuphos.android

import android.app.Application
import ai.nuphos.android.data.TokenStore
import ai.nuphos.android.session.AuthSession

class NuphosApplication : Application() {
    val incomingShares = ai.nuphos.android.session.IncomingShares()
    val incomingShareScope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Main.immediate)

    val conversationLinks = ai.nuphos.android.session.PendingConversationLink()
    lateinit var localNotifications: ai.nuphos.android.notifications.LocalNotifications
        private set
    lateinit var tokenStore: TokenStore
        private set
    lateinit var authSession: AuthSession
        private set

    lateinit var pushNotifications: ai.nuphos.android.notifications.PushNotifications
        private set

    override fun onCreate() {
        super.onCreate()
        // Pending attachment drafts are process-local. Remove only the previous process's share copies.
        java.io.File(filesDir, "incoming-share-attachments").deleteRecursively()
        tokenStore = TokenStore(this)
        authSession = AuthSession(this, tokenStore)
        localNotifications = ai.nuphos.android.notifications.LocalNotifications(this, { authSession.user?.id }, { authSession.aiAllowed })
        pushNotifications = ai.nuphos.android.notifications.PushNotifications(this)
        ai.nuphos.android.session.AiAccess.onRevoked = { pushNotifications.reset(clearPending = false); incomingShares.identityReset() }
        authSession.onIdentityReset = { pushNotifications.reset(); incomingShares.identityReset() }
        registerActivityLifecycleCallbacks(pushNotifications)
    }
}
