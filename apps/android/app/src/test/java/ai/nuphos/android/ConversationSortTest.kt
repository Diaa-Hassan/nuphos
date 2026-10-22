package ai.nuphos.android

import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.model.ConversationScope
import ai.nuphos.android.model.ConversationSort
import org.junit.Assert.*
import org.junit.Test

class ConversationSortTest {
    @Test fun ordersUseServerContractWithoutChangingOtherSelectors() {
        for (sort in ConversationSort.entries) {
            val query = NuphosApi.conversationQuery("team", cursor = "opaque-server-cursor",
                scope = ConversationScope.Team, search = "needle", archivedOnly = true, sort = sort).toMap()
            assertEquals(sort.raw, query["sort"])
            assertEquals("opaque-server-cursor", query["cursor"])
            assertEquals("team", query["scope"])
            assertEquals("needle", query["search"])
            assertEquals("only", query["archived"])
        }
    }

    @Test fun genericReadersAndTriggerRunsKeepActivityDefault() {
        assertEquals("activity", NuphosApi.conversationQuery("team").toMap()["sort"])
        val trigger = NuphosApi.conversationQuery("team", triggerId = "aaaaaaaaaaaaaaaaaaaaaaaa").toMap()
        assertEquals("activity", trigger["sort"])
        assertEquals("team", trigger["scope"])
        assertEquals("aaaaaaaaaaaaaaaaaaaaaaaa", trigger["triggerId"])
    }
}
