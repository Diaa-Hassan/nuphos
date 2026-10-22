package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.model.ChatRow
import ai.nuphos.android.ui.chat.TranscriptList
import ai.nuphos.android.ui.theme.NuphosTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class TranscriptScrollFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var state: LazyListState
    private var rows by mutableStateOf(initialRows())
    private var request by mutableStateOf(0)
    private var height by mutableStateOf(600)

    private fun initialRows() = (0..34).map { ChatRow.AssistantText("row-$it", "m-$it", "Synthetic history $it\nSecond line\nThird line", false) } + ChatRow.Bottom
    private fun render() {
        compose.setContent {
            NuphosTheme(darkTheme = false) {
                state = rememberLazyListState()
                Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.windowInsetsPadding(WindowInsets.safeDrawing).padding(16.dp)) {
                        Text("Transcript scroll fixture", style = MaterialTheme.typography.titleLarge)
                        TranscriptList(rows, request, Modifier.height(height.dp).fillMaxWidth(), state) { row ->
                            when (row) {
                                is ChatRow.AssistantText -> Text(row.text)
                                else -> Spacer(Modifier.height(1.dp))
                            }
                        }
                    }
                }
            }
        }
        atBottom()
    }
    private fun atBottom() = compose.waitUntil(10_000) { ::state.isInitialized && !state.canScrollForward && state.layoutInfo.totalItemsCount == rows.size }
    private fun settle() = compose.waitUntil(10_000) { !state.isScrollInProgress }
    private fun scrollUp() {
        compose.onNodeWithTag("transcript-list").performTouchInput { swipeDown() }
        settle()
        compose.onNodeWithText("Jump to latest").assertIsDisplayed()
    }
    private fun appendText() {
        compose.runOnIdle {
            val last = rows.filterIsInstance<ChatRow.AssistantText>().last()
            rows = rows.dropLast(2) + last.copy(text = last.text + "\n" + "Streaming line\n".repeat(8), streaming = true) + ChatRow.Bottom
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
    @Test fun readingOlderContentSurvivesNewRowsAndSameRowStreamingGrowth() {
        render(); scrollUp()
        val before = compose.runOnIdle { state.firstVisibleItemIndex to state.firstVisibleItemScrollOffset }
        appendText()
        compose.runOnIdle { assertEquals(before, state.firstVisibleItemIndex to state.firstVisibleItemScrollOffset) }
        compose.runOnIdle { rows = rows.dropLast(1) + ChatRow.AssistantText("new", "new", "New incoming message", true) + ChatRow.Bottom }
        compose.runOnIdle { assertEquals(before, state.firstVisibleItemIndex to state.firstVisibleItemScrollOffset) }
        capture("timeline-reader-position-light.png")
    }
    @Test fun bottomFollowsSameRowGrowthAndViewportResizeThenCanJumpBack() {
        render(); appendText(); atBottom()
        compose.runOnIdle { height = 360 }; atBottom()
        capture("timeline-stream-follow-light.png")
        scrollUp()
        compose.onNodeWithText("Jump to latest").performClick(); atBottom()
        compose.onNodeWithText("Jump to latest").assertDoesNotExist()
        appendText(); atBottom()
    }
    @Test fun ownSendRequestReturnsToBottomWithoutChangingHistory() {
        render(); scrollUp()
        val oldRows = rows
        compose.runOnIdle { request++ }; atBottom()
        compose.runOnIdle { assertEquals(oldRows, rows) }
        compose.onNodeWithText("Jump to latest").assertDoesNotExist()
    }
}
