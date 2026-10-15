package ai.nuphos.android.ui.agent

import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ai.nuphos.android.session.RuntimeSelections

/**
 * The current Agent, shown next to Send. Tapping opens its picker or usage details.
 */
@Composable
fun AgentChip(selection: RuntimeSelections.Selection?, enabled: Boolean, onClick: () -> Unit, labelOverride: String? = null, modifier: Modifier = Modifier) {
    val selected = selection?.selected
    val label = labelOverride ?: when {
        selection?.reselectionRequired == true -> "Choose an available Agent"
        selected != null -> selected.label
        else -> "Choose an Agent"
    }
    FilterChip(
        modifier = modifier,
        selected = selected != null || labelOverride != null,
        enabled = enabled,
        onClick = onClick,
        // Leave room for Send even on narrow screens.
        label = { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 160.dp)) },
        leadingIcon = { Icon(Icons.Outlined.AutoAwesome, contentDescription = if (labelOverride == null) "Agent for new chats" else "Conversation Agent", modifier = Modifier.size(16.dp)) },
    )
}
