package ai.nuphos.android

import android.Manifest
import android.content.pm.PackageManager
import android.media.*
import androidx.compose.material3.Text
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.voice.*
import java.io.File
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.json.JSONObject
import kotlin.math.sin

/** Supplemental evidence only. Real MIC + generated local tone; no OpenAI client or key store. */
class RealMicrophoneDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private fun foreground() {
        check(context.packageName == "ai.nuphos.android.whisperfixture")
        compose.setContent { Text("REAL MICROPHONE TEST · generated tone · no upload · audio deleted locally") }
        compose.waitForIdle()
    }
    private fun files() = context.cacheDir.listFiles().orEmpty().filter { it.name.startsWith("dictation-") }.map { it.name }.toSet()
    private fun report(name: String, values: Map<String, Any>) {
        val dir = File(context.getExternalFilesDir(null), "real-mic-evidence").apply { mkdirs() }
        File(dir, "$name.json").writeText(JSONObject(values + mapOf("realMicrophone" to true, "networkRequests" to 0, "audioExported" to false)).toString(2))
    }
    private fun tone(): AudioTrack {
        val rate = 22050
        val samples = ShortArray(rate) { (sin(2 * Math.PI * 440 * it / rate) * 1500).toInt().toShort() }
        return AudioTrack.Builder().setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).build())
            .setAudioFormat(AudioFormat.Builder().setSampleRate(rate).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
            .setBufferSizeInBytes(samples.size * 2).setTransferMode(AudioTrack.MODE_STATIC).build().apply {
                write(samples, 0, samples.size)
                play()
            }
    }
    @Test fun permissionDeniedDoesNotCreateFile() {
        foreground()
        assertEquals(PackageManager.PERMISSION_DENIED, context.checkSelfPermission(Manifest.permission.RECORD_AUDIO))
        val before = files()
        val take = MicrophoneTake(context)
        try { assertNotNull(runCatching { take.start() }.exceptionOrNull()) } finally { take.cancel() }
        assertEquals(before, files())
        report("permission-denied", mapOf("passed" to true, "newFiles" to 0))
    }
    @Test fun realFinishProducesAACAndDeletesFile() {
        foreground()
        val before = files()
        val take = MicrophoneTake(context)
        var sound: AudioTrack? = null
        try {
            take.start()
            sound = tone()
            // MediaRecorder's first maxAmplitude read establishes the sampling window.
            take.level()
            var level = 0f
            repeat(13) { Thread.sleep(100); level = maxOf(level, take.level()) }
            val file = take.stop()
            assertTrue(file.length() > 0)
            val extractor = MediaExtractor()
            val format = try { extractor.setDataSource(file.absolutePath); extractor.getTrackFormat(0) } finally { extractor.release() }
            assertEquals("audio/mp4a-latm", format.getString(MediaFormat.KEY_MIME))
            assertEquals(16000, format.getInteger(MediaFormat.KEY_SAMPLE_RATE))
            assertEquals(1, format.getInteger(MediaFormat.KEY_CHANNEL_COUNT))
            val duration = format.getLong(MediaFormat.KEY_DURATION)
            assertTrue("duration=$duration", duration in 500_000..4_000_000)
            assertTrue("No measured microphone amplitude", level > 0f)
            val bytes = file.length()
            take.cancel()
            assertFalse(file.exists())
            assertEquals(before, files())
            report("finish-aac", mapOf("passed" to true, "mime" to "audio/mp4a-latm", "sampleRate" to 16000,
                "channels" to 1, "durationUs" to duration, "bytesBeforeDeletion" to bytes, "peakLevel" to level.toDouble(), "audioDeleted" to true))
        } finally { sound?.release(); take.cancel() }
    }
    @Test fun realCancelDeletesTakeAndAllowsNextRecording() {
        foreground()
        val before = files()
        repeat(2) {
            val take = MicrophoneTake(context)
            var sound: AudioTrack? = null
            try {
                take.start(); sound = tone(); Thread.sleep(600)
                assertTrue(files().size > before.size)
            } finally { sound?.release(); take.cancel() }
            assertEquals(before, files())
        }
        report("cancel-release", mapOf("passed" to true, "takes" to 2, "audioDeleted" to true, "nextRecorderStarted" to true))
    }
    @Test fun realRecorderControllerFailureCleansAudioWithoutNetwork() {
        foreground()
        val before = files()
        var localTransportCalls = 0
        var appended = false
        val settings = object : VoiceSettings {
            override fun key() = "synthetic-not-a-real-key"
            override fun saveKey(value: String) = error("No key writes")
            override fun removeKey() = Unit
            override var prompt = "Synthetic test"
        }
        val transport = object : WhisperTransport {
            override suspend fun verify(key: String) = error("No key verification")
            override suspend fun transcribe(file: File, key: String, prompt: String): Transcript {
                assertTrue(file.length() > 0)
                localTransportCalls++
                throw java.io.IOException("Intentional local failure; no HTTP client")
            }
        }
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        val input = VoiceInput(VoiceServices(settings, transport, { MicrophoneTake(context) }), scope) { appended = true }
        var sound: AudioTrack? = null
        try {
            compose.runOnIdle { input.awaitingPermission(); input.permissionResult(true) }
            sound = tone(); Thread.sleep(1100)
            compose.runOnIdle { assertEquals(VoiceInput.Phase.Recording, input.phase); input.finish(); input.finish() }
            compose.waitUntil(5000) { input.phase == VoiceInput.Phase.Idle }
            compose.runOnIdle { assertNotNull(input.error); assertFalse(appended); assertEquals(1, localTransportCalls) }
            assertEquals(before, files())
            report("controller-error", mapOf("passed" to true, "localStubCalls" to localTransportCalls, "appended" to appended, "audioDeleted" to true))
        } finally { sound?.release(); compose.runOnIdle { input.cancel() }; scope.cancel() }
    }
}
