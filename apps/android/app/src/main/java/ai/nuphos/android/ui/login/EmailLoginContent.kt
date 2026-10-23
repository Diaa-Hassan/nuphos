package ai.nuphos.android.ui.login

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import ai.nuphos.android.data.AccountApi
import ai.nuphos.android.data.NuphosApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
internal fun EmailLoginContent(
    busy: Boolean,
    error: String?,
    onSubmit: (String, String, String?) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
    nowMillis: () -> Long = System::currentTimeMillis,
    requestCode: suspend (String) -> Unit = { AccountApi("").requestSignInCode(it) },
) {
    var email by rememberSaveable { mutableStateOf("") }
    var sentAt by rememberSaveable { mutableLongStateOf(0L) }
    var resendAt by rememberSaveable { mutableLongStateOf(0L) }
    var setPassword by rememberSaveable { mutableStateOf(false) }
    // Only non-secret progress is saveable. Recreation always asks for credentials again.
    var code by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var localError by remember { mutableStateOf<String?>(null) }
    var job by remember { mutableStateOf<Job?>(null) }
    var now by remember { mutableLongStateOf(nowMillis()) }
    val scope = rememberCoroutineScope()
    val uri = LocalUriHandler.current
    val waiting = sending || busy
    val sent = sentAt > 0
    val expired = sent && now >= sentAt + EmailCodeTiming.EXPIRY_MS
    val seconds = EmailCodeTiming.remainingSeconds(resendAt, now)
    LaunchedEffect(Unit) {
        while (true) { now = nowMillis(); delay(1_000) }
    }
    fun cancel() { job?.cancel(); code = ""; password = ""; onCancel() }
    fun send() {
        if (waiting || nowMillis() < resendAt) return
        sending = true; localError = null; code = ""; password = ""
        // Reserve cooldown before dispatch; recreation/uncertain delivery must not send twice.
        resendAt = nowMillis() + EmailCodeTiming.COOLDOWN_MS
        job = scope.launch {
            try {
                requestCode(email.trim())
                sentAt = nowMillis()
                resendAt = sentAt + EmailCodeTiming.COOLDOWN_MS
                password = ""
            } catch (e: CancellationException) { throw e }
            catch (e: NuphosApi.Failure.Http) {
                localError = when (e.code) {
                    400 -> "Enter a valid email address."
                    429 -> "Too many codes requested. Wait and try again later."
                    else -> "Could not send the code. Check your connection and try again."
                }
            } catch (_: Exception) {
                localError = "Could not confirm delivery. Wait before trying again."
            } finally { sending = false }
        }
    }
    BackHandler { cancel() }
    Column(modifier.fillMaxSize().systemBarsPadding().imePadding()
        .verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Welcome to Nuphos", style = MaterialTheme.typography.headlineLarge)
        Text("Sign in with your email. New accounts are created after email verification.")
        OutlinedTextField(email, { email = it.take(254); localError = null },
            label = { Text("Email address") }, singleLine = true, enabled = !waiting && !sent,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth())
        if (sent) {
            OutlinedTextField(code, { code = it.filter { c -> c in '0'..'9' }.take(6); localError = null },
                label = { Text("6-digit email code") }, singleLine = true, enabled = !waiting && !expired,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), modifier = Modifier.fillMaxWidth())
            Text(if (expired) "Code expired. Request a new code." else "Check your inbox. The code expires in 10 minutes.")
            Row {
                Checkbox(setPassword, { setPassword = it; password = "" }, enabled = !waiting)
                Text("Set or reset my password", modifier = Modifier.padding(top = 12.dp))
            }
            if (setPassword) OutlinedTextField(password, { password = it.take(128) },
                label = { Text("New password (12–128 characters)") }, singleLine = true, enabled = !waiting,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
        }
        (localError ?: error)?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Button(onClick = {
            if (!sent) send()
            else if (!waiting && !expired && code.length == 6 && (!setPassword || password.length in 12..128)) {
                val submittedCode = code
                val submittedPassword = if (setPassword) password else null
                code = ""; password = ""; localError = null
                onSubmit(email.trim(), submittedCode, submittedPassword)
            }
        }, enabled = !waiting && if (sent) !expired && code.length == 6 && (!setPassword || password.length in 12..128)
            else email.isNotBlank() && seconds == 0, modifier = Modifier.fillMaxWidth()) {
            Text(if (waiting) "Please wait…" else if (sent) "Sign in" else "Send verification code")
        }
        if (sent) TextButton(onClick = { send() }, enabled = !waiting && seconds == 0) {
            Text(if (seconds == 0) "Resend code" else "Resend in ${seconds}s")
        }
        if (sent) TextButton(onClick = {
            sentAt = 0; code = ""; password = ""; localError = null
        }, enabled = !waiting) { Text("Use a different email") }
        if (!sent && seconds > 0) Text("You can request another code in ${seconds}s.")
        Row {
            TextButton(onClick = { uri.openUri("https://nuphos.ai/terms") }) { Text("Terms") }
            TextButton(onClick = { uri.openUri("https://nuphos.ai/privacy") }) { Text("Privacy policy") }
        }
        Text("By continuing, you agree to the Terms of Service.", style = MaterialTheme.typography.bodySmall)
        TextButton(onClick = { cancel() }) { Text("Cancel") }
    }
}

internal object EmailCodeTiming {
    const val COOLDOWN_MS = 60_000L
    const val EXPIRY_MS = 600_000L
    fun remainingSeconds(deadline: Long, now: Long): Int =
        ((deadline - now).coerceAtLeast(0L).coerceAtMost(COOLDOWN_MS) + 999L).div(1_000).toInt()
}
