package ai.nuphos.android.session

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/** One gesture owns its indicator until all its reads finish. Workspace resets expire it. */
internal class HistoryRefresh {
    var running by mutableStateOf(false)
        private set
    private var generation = 0L

    fun invalidate() {
        generation++
        running = false
    }

    fun start(scope: CoroutineScope, read: suspend () -> Unit) {
        if (running) return
        val request = ++generation
        running = true
        scope.launch {
            try {
                if (request == generation) read()
            } finally {
                if (request == generation) running = false
            }
        }.invokeOnCompletion {
            // Also covers a scope already cancelled before launch dispatches.
            if (request == generation) running = false
        }
    }
}
