package ai.nuphos.android

import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.*
import org.junit.Assert.*
import org.junit.Test

class TimelineAlignmentTest {
    @Test fun onlyLiveTrailingReasoningIsHiddenWithoutChangingWire() {
        val leading = ChatPart.Reasoning(text = "Earlier thought")
        val trailing = ChatPart.Reasoning(text = "Current thought", state = ChatPart.StreamState.Streaming)
        val m = ChatMessage(id = "m", parts = listOf(leading, ChatPart.Text(text = "A result"), trailing))
        val live = ChatRow.rows(listOf(m), isStreaming = true)
        assertEquals(listOf("Earlier thought"), live.filterIsInstance<ChatRow.Reasoning>().map { it.part.text })
        assertEquals(2, ChatRow.rows(listOf(m)).filterIsInstance<ChatRow.Reasoning>().size)
        assertEquals(listOf(leading, ChatPart.Text(text = "A result"), trailing), m.parts)
    }
    @Test fun noChangeMemoryRowsStayHiddenWhileRealUpdatesRemainVisible() {
        fun memory(created: Int, updated: Int) = ChatPart.Other(JsonValue.parse(
            """{"type":"memory-ingest","eventId":"same","memoriesCreated":$created,"memoriesUpdated":$updated}""")!!)
        val empty = ChatMessage(id = "empty", parts = listOf(memory(0, 0)))
        assertTrue(ChatRow.rows(listOf(empty)).none { it is ChatRow.Memory })
        val changed = ChatMessage(id = "changed", parts = listOf(memory(1, 0)))
        val another = changed.copy(id = "another")
        val rows = ChatRow.rows(listOf(empty, changed, another)).filterIsInstance<ChatRow.Memory>()
        assertEquals(2, rows.size)
        assertEquals(2, rows.map { it.id }.distinct().size)
    }
    @Test fun stoppedMarkersSurviveLaterTurnsAndDoNotMarkAnActiveTurnStopped() {
        val tool = ChatPart.Tool(toolCallId = "call", toolName = "terminal", isDynamic = false, state = ChatPart.Tool.State.OutputAvailable)
        val first = ChatMessage(id = "first", stoppedByUser = true, parts = listOf(tool))
        val second = ChatMessage(id = "second", stoppedByUser = true, parts = listOf(ChatPart.Text(text = "Stopped text")))
        val rows = ChatRow.rows(listOf(first, second, ChatMessage(id = "last", parts = listOf(ChatPart.Text(text = "New turn")))), isStreaming = true)
        val markers = rows.filterIsInstance<ChatRow.Hint>().filter { it.id.startsWith("stopped.") }
        assertEquals(listOf("stopped.first", "stopped.second"), markers.map { it.id })
        assertEquals("Stopped by you · 1 call", markers.first().text)
        assertEquals("Stopped by you", markers.last().text)
        assertTrue(ChatRow.rows(listOf(second), isStreaming = true).none { it is ChatRow.Hint })
    }
    @Test fun activityKeepsIdentityAcrossLiveAndIdleStatusAndDoesNotInventIdleRows() {
        val live = ChatRow.rows(emptyList(), isStreaming = true, phaseLabel = "Working").filterIsInstance<ChatRow.Activity>().single()
        val idle = ChatRow.rows(emptyList(), phaseLabel = "Ready").filterIsInstance<ChatRow.Activity>().single()
        assertEquals(live.id, idle.id)
        assertTrue(live.live)
        assertFalse(idle.live)
        assertTrue(ChatRow.rows(emptyList()).none { it is ChatRow.Activity })
    }
}
