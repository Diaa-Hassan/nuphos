package ai.nuphos.android.model

/** New-composer state only, matching iOS CredentialDraft. Never persisted or applied to stored chats. */
data class CredentialDraft(
    val catalog: CredentialCatalog? = null,
    val error: String? = null,
    val selection: CredentialSelection = CredentialSelection(newConversation = true),
    private val load: Long = 0,
) {
    val isReady: Boolean get() = catalog != null || error != null

    fun begin(): CredentialDraft = copy(load = load + 1)
    val request: Long get() = load

    fun finish(request: Long, result: Result<CredentialCatalog>): CredentialDraft {
        if (request != load) return this
        return result.fold(
            onSuccess = { fresh -> copy(catalog = fresh, error = null,
                selection = (if (catalog == null) selection.selectDefaults(fresh) else selection).pruned(fresh)) },
            onFailure = { copy(error = it.message ?: "Could not load IAM. Try again.") },
        )
    }

    /** Orphan requests even after switching away and back to the same team. */
    fun reset(): CredentialDraft = CredentialDraft(load = load + 1)
}
