package ai.nuphos.android.session

import ai.nuphos.android.model.ComposerAttachment
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Main-thread mailbox. Ownership moves to a composer only after a matching, explicit choice. */
class IncomingShares {
    data class Pending(
        val id: Long,
        val accountId: String?,
        val text: String = "",
        val attachments: List<ComposerAttachment> = emptyList(),
        val loading: Boolean = true,
        val error: String? = null,
        val destination: ComposerDrafts.Key? = null,
    )
    private val delivered = mutableMapOf<ComposerDrafts.Key, List<ComposerAttachment>>()
    fun attachments(key: ComposerDrafts.Key) = delivered[key].orEmpty()
    fun owns(key: ComposerDrafts.Key, id: String) = attachments(key).any { it.id == id }
    fun forgetAttachment(key: ComposerDrafts.Key, id: String) {
        val remaining = attachments(key).filterNot { it.id == id }
        if (remaining.isEmpty()) delivered.remove(key) else delivered[key] = remaining
    }
    fun sent(key: ComposerDrafts.Key) { delivered.remove(key) } // session owns the files after Send
    private fun clearDelivered() {
        delivered.values.flatten().forEach { it.releaseOwnedCopy() }
        delivered.clear()
    }
    private var sequence = 0L
    private val mutable = MutableStateFlow<Pending?>(null)
    val state = mutable.asStateFlow()

    fun begin(accountId: String?): Long? {
        if (mutable.value != null) return null
        val id = ++sequence
        mutable.value = Pending(id, accountId)
        return id
    }
    fun loaded(id: Long, text: String, attachments: List<ComposerAttachment>): Boolean {
        val current = mutable.value
        if (current?.id != id) { attachments.forEach { it.releaseOwnedCopy() }; return false }
        val retainedBytes = delivered.values.flatten().sumOf { it.sizeBytes }
        if (retainedBytes + attachments.sumOf { it.sizeBytes } > ai.nuphos.android.data.AttachmentTransfers.MAX_TOTAL_BYTES) {
            attachments.forEach { it.releaseOwnedCopy() }
            failed(id, "Shared attachment drafts exceed 500 MiB. Send or remove an existing draft first.")
            return false
        }
        mutable.value = current.copy(text = text, attachments = attachments, loading = false)
        return true
    }
    fun failed(id: Long, error: String) {
        val current = mutable.value ?: return
        if (current.id == id) mutable.value = current.copy(loading = false, error = error, destination = null)
    }
    fun bindAccount(accountId: String) {
        if (delivered.keys.any { it.accountId != accountId }) clearDelivered()
        val current = mutable.value ?: return
        if (current.accountId == null) mutable.value = current.copy(accountId = accountId)
        else if (current.accountId != accountId) cancel()
    }
    fun choose(id: Long, key: ComposerDrafts.Key): Boolean {
        val current = mutable.value ?: return false
        if (current.id != id || current.loading || current.error != null || current.accountId != key.accountId) return false
        mutable.value = current.copy(destination = key)
        return true
    }
    fun consumed(id: Long, key: ComposerDrafts.Key): Boolean {
        val current = mutable.value ?: return false
        if (current.id != id || current.destination != key) return false
        if (current.attachments.isNotEmpty()) delivered[key] = (attachments(key) + current.attachments).distinctBy { it.id }
        mutable.value = null // shared copies remain available when the destination composer is recreated
        return true
    }
    fun cancel() {
        val current = mutable.value
        mutable.value = null
        current?.attachments?.forEach { it.releaseOwnedCopy() }
    }
    fun identityReset() {
        clearDelivered()
        if (mutable.value?.accountId != null) cancel()
    }
}
