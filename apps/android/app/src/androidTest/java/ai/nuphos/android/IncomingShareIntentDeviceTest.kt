package ai.nuphos.android

import android.content.ClipData
import android.content.Intent
import android.net.Uri
import ai.nuphos.android.data.IncomingShareIntents
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class IncomingShareIntentDeviceTest {
    @Test fun textAndScreenshotUrlArePreservedAndDuplicateStreamIsReadOnce() {
        val uri = Uri.parse("content://synthetic/image.png")
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "image/png"
            putExtra(Intent.EXTRA_TEXT, "https://example.com/synthetic")
            putExtra(Intent.EXTRA_STREAM, uri)
            clipData = ClipData.newRawUri("Synthetic", uri)
        }
        val payload = IncomingShareIntents.read(intent)
        assertEquals("https://example.com/synthetic", payload.text)
        assertEquals(listOf(uri), payload.uris)
    }
    @Test fun multipleFilesAndClipTextSurviveTogether() {
        val uris = arrayListOf(Uri.parse("content://synthetic/one"), Uri.parse("content://synthetic/two"))
        val intent = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
            type = "*/*"
            putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
            clipData = ClipData.newPlainText("Synthetic", "notes")
        }
        assertEquals(uris, IncomingShareIntents.read(intent).uris)
        assertEquals("notes", IncomingShareIntents.read(intent).text)
    }
    @Test fun rejectsFileUrisEmptyPayloadOversizeTextAndTooManyFiles() {
        val invalid = listOf(
            Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, Uri.parse("file:///private/fixture")),
            Intent(Intent.ACTION_SEND),
            Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_TEXT, "x".repeat(100_001)),
            Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM,
                ArrayList((1..21).map { Uri.parse("content://synthetic/$it") })),
        )
        invalid.forEach { intent ->
            try { IncomingShareIntents.read(intent); fail("Accepted an invalid share") }
            catch (_: IllegalArgumentException) { }
        }
        assertFalse(IncomingShareIntents.accepts(Intent(Intent.ACTION_VIEW)))
    }
}
