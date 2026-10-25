import SwiftUI

@main
struct NuphosApp: App {
    #if canImport(UIKit)
    @UIApplicationDelegateAdaptor(PushAppDelegate.self) private var pushDelegate
    #endif
    @State private var session = AuthSession()

    var body: some Scene {
        WindowGroup {
            #if DEBUG && os(iOS)
            if CommandLine.arguments.contains("-scroll-regression") {
                TranscriptRegressionScreen()
            } else if CommandLine.arguments.contains("-preview-desktop") {
                // With `-apiBaseURL http://127.0.0.1:<port>` pointing at a fixture desktop server.
                DesktopScreen(desktop: DesktopSession(teamId: "preview", sessionId: "preview", token: "preview"), title: "Demo Mac")
            } else {
                RootView()
                    .environment(session)
            }
            #else
            RootView()
                .environment(session)
            #endif
        }
        .commands { NewChatCommand() }
    }
}

extension FocusedValues {
    /// Opens the new-chat composer in the focused window.
    @Entry var newChat: (() -> Void)?
}

/// ⌘N, listed in the menu bar.
private struct NewChatCommand: Commands {
    @FocusedValue(\.newChat) private var newChat

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Agent") { newChat?() }
                .keyboardShortcut("n")
                .disabled(newChat == nil)
        }
    }
}
