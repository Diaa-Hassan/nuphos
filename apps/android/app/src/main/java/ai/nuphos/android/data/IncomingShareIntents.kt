package ai.nuphos.android.data

import android.content.Intent
import android.net.Uri
import androidx.core.content.IntentCompat

/** Does not resolve URLs or coerce clipboard items: only explicit plain text and granted content URIs. */
object IncomingShareIntents {
    data class Payload(val text: String, val uris: List<Uri>)
    fun accepts(intent: Intent?) = intent?.action == Intent.ACTION_SEND || intent?.action == Intent.ACTION_SEND_MULTIPLE
    fun read(intent: Intent): Payload {
        require(accepts(intent)) { "Unsupported sharing action." }
        val texts = linkedSetOf<String>()
        val uris = linkedSetOf<Uri>()
        fun text(value: CharSequence?) {
            if (value.isNullOrBlank()) return
            require(value.length <= MAX_TEXT) { "Shared text exceeds 100,000 characters." }
            texts += value.toString()
        }
        fun attachment(uri: Uri) {
            require(uri.scheme == "content") { "Only content-provider attachments can be shared." }
            uris += uri
            require(uris.size <= AttachmentTransfers.MAX_FILES) { "Share at most 20 files." }
        }
        text(intent.getCharSequenceExtra(Intent.EXTRA_TEXT))
        if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
            val items = IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
            require(items.size <= AttachmentTransfers.MAX_FILES) { "Share at most 20 files." }
            items.forEach(::attachment)
        } else IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)?.let(::attachment)
        intent.clipData?.let { clip ->
            require(clip.itemCount <= AttachmentTransfers.MAX_FILES + 1) { "Too many shared items." }
            for (index in 0 until clip.itemCount) {
                val item = clip.getItemAt(index)
                text(item.text)
                item.uri?.let { uri ->
                    if (uri.scheme in setOf("http", "https")) text(uri.toString()) else attachment(uri)
                }
            }
        }
        val combined = texts.joinToString("\n\n")
        require(combined.length <= MAX_TEXT) { "Shared text exceeds 100,000 characters." }
        require(combined.isNotBlank() || uris.isNotEmpty()) { "This share contains no readable text or files." }
        return Payload(combined, uris.toList())
    }
    const val MAX_TEXT = 100_000
}
