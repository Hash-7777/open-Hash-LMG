// The window shows the app and nothing else.
//
// The app is one page, and nothing in it means to replace that page with
// another address. Any attempt to is refused here before the web view acts
// on it: a link meant for the browser, a refresh written into markup, a
// script setting the location. Links a person clicks open in the system
// browser instead (src/platform/index.js), so refusing here costs nothing.
//
// The app's own address is tauri://localhost on macOS and Linux and
// http(s)://tauri.localhost on Windows; about:blank and about:srcdoc are not
// addresses at all.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Runtime, Url};

pub fn is_app_address(url: &Url) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => url.host_str() == Some("tauri.localhost"),
        "about" => matches!(url.path(), "blank" | "srcdoc"),
        _ => false,
    }
}

pub fn guard<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("navigation-guard")
        .on_navigation(|_webview, url| is_app_address(url))
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowed(s: &str) -> bool {
        is_app_address(&Url::parse(s).expect("a URL"))
    }

    #[test]
    fn the_app_itself_may_load_and_reload() {
        for s in ["tauri://localhost", "tauri://localhost/index.html?x=1#top", "http://tauri.localhost/index.html", "https://tauri.localhost/", "about:blank", "about:srcdoc"] {
            assert!(allowed(s), "{s} must be allowed");
        }
    }

    #[test]
    fn anywhere_else_is_refused() {
        for s in [
            "https://example.com/",
            "http://localhost:5173/",
            "https://tauri.localhost.example.test/",
            "https://example.test/tauri.localhost",
            "tauri://example.test/",
            "file:///etc/hosts",
            "data:text/html,<p>x</p>",
            "blob:tauri://localhost/1234",
            "about:config",
        ] {
            assert!(!allowed(s), "{s} must be refused");
        }
    }
}
