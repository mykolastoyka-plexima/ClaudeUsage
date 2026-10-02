fn main() {
    // Every app command gets its own permission so the claude.ai fetcher webview
    // can be granted exactly one of them (usage_report) and nothing else.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "usage_report",
            "get_state",
            "get_history",
            "refresh_now",
            "set_settings",
            "open_login",
            "logout",
            "resize_popover",
            "hide_popover",
            "quit_app",
        ]),
    ))
    .expect("failed to run tauri-build");
}
