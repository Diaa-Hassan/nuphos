package ai.nuphos.android.session

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class HistoryRefreshTest {
    @Test fun repeatedGestureRunsOnceAndIndicatorWaitsForBothSources() = runTest {
        val refresh = HistoryRefresh()
        val history = CompletableDeferred<Unit>(); val pins = CompletableDeferred<Unit>()
        var calls = 0
        refresh.start(this) {
            calls++
            coroutineScope { launch { history.await() }; launch { pins.await() } }
        }
        refresh.start(this) { calls++ }
        runCurrent(); assertEquals(1, calls); assertTrue(refresh.running)
        history.complete(Unit); runCurrent(); assertTrue(refresh.running)
        pins.complete(Unit); runCurrent(); assertFalse(refresh.running)
        refresh.start(this) { calls++ }; runCurrent(); assertEquals(2, calls)
    }

    @Test fun oldWorkspaceCompletionCannotStopNewWorkspaceIndicator() = runTest {
        val refresh = HistoryRefresh()
        val old = CompletableDeferred<Unit>(); val current = CompletableDeferred<Unit>()
        refresh.start(this) { old.await() }; runCurrent()
        refresh.invalidate(); refresh.start(this) { current.await() }; runCurrent()
        old.complete(Unit); runCurrent(); assertTrue(refresh.running)
        current.complete(Unit); runCurrent(); assertFalse(refresh.running)
    }

    @Test fun consentCancellationAndAlreadyCancelledScopeFinishIndicator() = runTest {
        val refresh = HistoryRefresh()
        val scope = CoroutineScope(coroutineContext + Job())
        refresh.start(scope) { CompletableDeferred<Unit>().await() }; runCurrent()
        assertTrue(refresh.running)
        scope.cancel(); runCurrent(); assertFalse(refresh.running)
        refresh.start(scope) { fail("Cancelled scope must never start network reads") }
        runCurrent(); assertFalse(refresh.running)
    }

    @Test fun workspaceChangeBeforeDispatchDoesNotStartOldRead() = runTest {
        val refresh = HistoryRefresh(); var calls = 0
        refresh.start(this) { calls++ }; refresh.invalidate(); runCurrent()
        assertEquals(0, calls); assertFalse(refresh.running)
    }
}
