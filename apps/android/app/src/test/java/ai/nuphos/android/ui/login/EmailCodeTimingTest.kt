package ai.nuphos.android.ui.login

import org.junit.Assert.assertEquals
import org.junit.Test

class EmailCodeTimingTest {
    @Test fun cooldownRoundsUpAndEnablesAtDeadline() {
        assertEquals(60, EmailCodeTiming.remainingSeconds(60_000, 0))
        assertEquals(1, EmailCodeTiming.remainingSeconds(60_000, 59_999))
        assertEquals(0, EmailCodeTiming.remainingSeconds(60_000, 60_000))
        assertEquals(0, EmailCodeTiming.remainingSeconds(60_000, 90_000))
    }
    @Test fun backwardsClockCannotShowUnboundedCooldown() {
        assertEquals(60, EmailCodeTiming.remainingSeconds(60_000, -100_000))
        assertEquals(600_000L, EmailCodeTiming.EXPIRY_MS)
    }
}
