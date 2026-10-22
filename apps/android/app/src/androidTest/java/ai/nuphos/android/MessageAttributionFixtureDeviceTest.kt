package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.model.*
import ai.nuphos.android.ui.chat.AgentEventRow
import ai.nuphos.android.ui.chat.MessageSenderLabel
import ai.nuphos.android.ui.theme.NuphosTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Synthetic UI only; no auth, transport, microphone or production activity. */
@RunWith(AndroidJUnit4::class)
class MessageAttributionFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private fun render() {
        compose.setContent {
            NuphosTheme(darkTheme = false) {
                Surface {
                    Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Message attribution fixture", style = MaterialTheme.typography.titleLarge)
                        MessageSenderLabel(MessageAttribution("token", "Test Bot", "agent", "nuphos", "Can"))
                        Text("A token message stays a message.")
                        AgentEventRow(ChatRow.Event("event", ChatRow.User("event-content", "event-message",
                            "CI completed\nFull event details stay readable.", emptyList(),
                            sender = MessageAttribution("github", "GitHub", "system", "agent.resource"))), {}) {
                            Text("Fixture attachment preserved")
                        }
                        AgentEventRow(ChatRow.Event("thread", ChatRow.User("thread-content", "thread-message",
                            "Android checks finished\nThe source session supplied this update.", emptyList(),
                            sender = MessageAttribution("session", "Android Agent", "agent", "agent.thread"))), {})
                        Text("An ordinary user message stays ordinary.")
                    }
                }
            }
        }
    }
    private fun capture(name: String) {
        compose.waitForIdle()
        val inst = InstrumentationRegistry.getInstrumentation()
        inst.waitForIdleSync()
        android.os.SystemClock.sleep(500)
        File(inst.targetContext.getExternalFilesDir(null), name).outputStream().use {
            inst.uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }
    @Test fun compactEventsExpandWithoutHidingAttributionOrAttachments() {
        render()
        compose.onNodeWithText("Test Bot · via Can").assertIsDisplayed()
        compose.onNodeWithText("Full event details stay readable.", substring = true).assertDoesNotExist()
        capture("attribution-collapsed-light.png")
        compose.onNodeWithText("CI completed").performClick()
        compose.onNodeWithText("Fixture attachment preserved").assertIsDisplayed()
        compose.onNodeWithText("Full event details stay readable.", substring = true).assertExists()
        capture("attribution-expanded-light.png")
        compose.onNodeWithContentDescription("Collapse event").performClick()
        compose.onNodeWithText("Fixture attachment preserved").assertDoesNotExist()
        compose.onNodeWithText("Android checks finished").assertIsDisplayed()
    }
}
