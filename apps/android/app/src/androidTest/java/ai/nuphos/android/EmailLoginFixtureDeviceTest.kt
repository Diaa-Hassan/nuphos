package ai.nuphos.android

import androidx.compose.material3.Surface
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.ui.login.EmailLoginContent
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.CompletableDeferred
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.atomic.AtomicLong

/** Standalone synthetic content; never reads tokens, preferences or a live API. */
class EmailLoginFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val clock = AtomicLong(1_000_000L)
    private val busy = mutableStateOf(false)
    private val authError = mutableStateOf<String?>(null)
    private var requests = 0
    private var submits = 0
    private var cancellations = 0
    private var receivedPassword = false
    private var transport: suspend () -> Unit = {}

    @Before fun isolatedPackageOnly() {
        check(InstrumentationRegistry.getInstrumentation().targetContext.packageName == "ai.nuphos.android.emailfixture1335")
    }
    @androidx.compose.runtime.Composable
    private fun content() {
        Surface { EmailLoginContent(busy.value, authError.value, { email, code, password ->
            assertEquals("fixture@example.com", email)
            assertEquals(6, code.length)
            receivedPassword = password != null
            submits++; busy.value = true
        }, { cancellations++ }, nowMillis = clock::get, requestCode = {
            assertEquals("fixture@example.com", it); requests++; transport()
        }) }
    }
    private fun render() { compose.setContent { NuphosTheme(darkTheme = InstrumentationRegistry.getArguments().getString("darkTheme") == "true") { content() } } }
    private fun send() {
        compose.onNodeWithText("Email address").performTextInput("fixture@example.com")
        compose.onNodeWithText("Send verification code").performScrollTo().performClick()
        compose.waitUntil { requests == 1 }
        compose.waitForIdle()
    }
    private fun advance(millis: Long) {
        clock.addAndGet(millis)
        compose.mainClock.advanceTimeBy(1_100)
        compose.waitForIdle()
    }
    @Test fun captureSyntheticEmptyCredentials() {
        render(); send()
        compose.waitForIdle()
        val inst = InstrumentationRegistry.getInstrumentation()
        val theme = if (InstrumentationRegistry.getArguments().getString("darkTheme") == "true") "dark" else "light"
        java.io.File(inst.targetContext.getExternalFilesDir(null), "email-code-$theme.png").outputStream().use {
            inst.uiAutomation.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
        compose.onNode(isToggleable()).performScrollTo().performClick()
        compose.onNodeWithText("New password (12–128 characters)").performScrollTo()
        compose.waitForIdle()
        java.io.File(inst.targetContext.getExternalFilesDir(null), "email-reset-$theme.png").outputStream().use {
            inst.uiAutomation.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    @Test fun sendsOnceEnforcesCooldownAndResendReplacesCode() {
        render(); send()
        compose.onNodeWithText("6-digit email code").performTextInput("123456")
        compose.onNodeWithText("Resend in 60s").assertIsNotEnabled()
        advance(60_000)
        compose.onNodeWithText("Resend code").performScrollTo().performClick()
        compose.waitUntil { requests == 2 }
        compose.onNodeWithText("Sign in").assertIsNotEnabled()
        compose.onNodeWithText("Resend in 60s").assertIsNotEnabled()
    }
    @Test fun passwordResetNeedsFullCredentialsAndGuardsSecondSubmit() {
        render(); send()
        compose.onNodeWithText("6-digit email code").performTextInput("123456")
        compose.onNode(isToggleable()).performScrollTo().performClick()
        compose.onNodeWithText("Sign in").assertIsNotEnabled()
        compose.onNodeWithText("New password (12–128 characters)").performTextInput("synthetic-password")
        compose.onNodeWithText("Sign in").performScrollTo().performClick()
        compose.onNodeWithText("Please wait…").assertIsNotEnabled()
        assertEquals(1, submits); assertTrue(receivedPassword)
        compose.onNodeWithText("Cancel").performScrollTo().performClick()
        assertEquals(1, cancellations)
    }
    @Test fun wrongCodeCanRetryWithoutAnotherEmailAndSignupNeedsNoPassword() {
        render(); send()
        compose.onNodeWithText("6-digit email code").performTextInput("123456")
        compose.onNodeWithText("Sign in").performScrollTo().performClick()
        compose.runOnIdle {
            busy.value = false
            authError.value = "Incorrect or expired code. Request a new code if needed."
        }
        compose.onNodeWithText("Incorrect or expired code. Request a new code if needed.").assertExists()
        compose.onNodeWithText("Sign in").assertIsNotEnabled()
        compose.onNodeWithText("6-digit email code").performTextInput("654321")
        compose.onNodeWithText("Sign in").performScrollTo().performClick()
        assertEquals(2, submits); assertEquals(1, requests); assertFalse(receivedPassword)
    }

    @Test fun expiredCodeCannotSubmitAndCanRequestAnother() {
        render(); send()
        compose.onNodeWithText("6-digit email code").performTextInput("123456")
        advance(600_000)
        compose.onNodeWithText("Sign in").assertIsNotEnabled()
        compose.onNodeWithText("Code expired. Request a new code.").assertExists()
        compose.onNodeWithText("Resend code").performScrollTo().performClick()
        compose.waitUntil { requests == 2 }
    }
    @Test fun recreationKeepsDeliveryProgressButNeverRestoresSecrets() {
        val restoration = StateRestorationTester(compose)
        restoration.setContent { NuphosTheme(darkTheme = InstrumentationRegistry.getArguments().getString("darkTheme") == "true") { content() } }
        send()
        compose.onNodeWithText("6-digit email code").performTextInput("123456")
        compose.onNode(isToggleable()).performScrollTo().performClick()
        compose.onNodeWithText("New password (12–128 characters)").performTextInput("synthetic-password")
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithText("Email address").assert(hasText("fixture@example.com"))
        compose.onNodeWithText("Sign in").assertIsNotEnabled()
        compose.onNodeWithText("6-digit email code").assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("")))
        compose.onNodeWithText("New password (12–128 characters)").assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("")))
        compose.onNodeWithText("Resend in 60s").assertIsNotEnabled()
        assertEquals(1, requests)
    }
    @Test fun canceledDeliveryCannotSubmitOrAcceptLateSuccess() {
        val held = CompletableDeferred<Unit>()
        transport = { held.await() }
        render(); send()
        compose.onNodeWithText("Please wait…").assertIsNotEnabled()
        compose.onNodeWithText("Cancel").performScrollTo().performClick()
        held.complete(Unit)
        compose.waitForIdle()
        assertEquals(1, cancellations); assertEquals(0, submits)
    }
    @Test fun requestFailureKeepsEmailAndDoesNotRetryAutomatically() {
        transport = { throw NuphosApi.Failure.Http(429, "untrusted transport text") }
        render(); send()
        compose.onNodeWithText("Too many codes requested. Wait and try again later.").assertExists()
        compose.onNodeWithText("untrusted transport text").assertDoesNotExist()
        compose.onNodeWithText("Send verification code").assertIsNotEnabled()
        advance(60_000)
        compose.onNodeWithText("Send verification code").performScrollTo().performClick()
        compose.waitUntil { requests == 2 }
        assertEquals(0, submits)
    }
}
