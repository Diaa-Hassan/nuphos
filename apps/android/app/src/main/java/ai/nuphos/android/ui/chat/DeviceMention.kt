package ai.nuphos.android.ui.chat

import ai.nuphos.android.model.CredentialCatalog
import ai.nuphos.android.model.CredentialSelection

/** Only an explicit candidate click may add a device through the existing IAM selection. */
data class DeviceMentionSource(
    val teamId: String,
    val load: suspend () -> List<CredentialCatalog.Item>,
    val pick: (CredentialCatalog.Item) -> Boolean,
)

object DeviceMention {
    fun results(items: List<CredentialCatalog.Item>, query: String, selection: CredentialSelection): List<CredentialCatalog.Item> =
        items.filter {
            it.provider.optionsKey == "devices" && it.provider.selectionKey == "deviceIds" &&
                it.id.isNotBlank() && it.label.isNotBlank() &&
                (!it.unavailable || selection.contains(it)) && it.label.contains(query, ignoreCase = true)
        }.distinctBy { it.id }.take(3)

    fun select(selection: CredentialSelection, device: CredentialCatalog.Item): CredentialSelection? {
        if (device.provider.optionsKey != "devices" || device.provider.selectionKey != "deviceIds" ||
            device.unavailable || device.id.isBlank() || device.label.isBlank()) return null
        return if (selection.contains(device)) selection else selection.toggle(device)
    }
}
