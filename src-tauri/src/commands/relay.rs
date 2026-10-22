// Model servers a web page may not ask directly.
//
// A browser asks a server's permission before a page may send it a request.
// Some model servers never grant it: a model app on this computer until its
// own switch is turned on, and some cloud services always. A request made
// here is not a page's request, so no permission is asked.
//
// The page names a service and a route ("chat" or "models"), and for an app
// on this computer a port; the address comes from the table below, with no
// part of it taken from the page. The page supplies the body and, for a cloud
// service, the person's own key, which goes in one header to that one host.
// The reply streams back through a channel as it arrives, in order: a head,
// chunks of text, then an end, or a failure in plain words instead.

use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::ipc::Channel;
use ureq::config::Config;
use ureq::tls::{TlsConfig, TlsProvider};
use ureq::Agent;

const MAX_BODY: usize = 8 * 1024 * 1024;
const MAX_REPLY: u64 = 64 * 1024 * 1024;

/// Every address this file can reach. A page's request picks a row; it never
/// builds one.
pub fn endpoint(provider: &str, route: &str, port: Option<u16>) -> Option<String> {
    let local = |path: &str| port.filter(|p| *p >= 1024).map(|p| format!("http://127.0.0.1:{p}{path}"));
    match (provider, route) {
        ("lmstudio" | "llamacpp", "chat") => local("/v1/chat/completions"),
        ("lmstudio" | "llamacpp", "models") => local("/v1/models"),
        ("moonshot", "chat") => Some("https://api.moonshot.ai/v1/chat/completions".into()),
        ("moonshot", "models") => Some("https://api.moonshot.ai/v1/models".into()),
        _ => None,
    }
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum RelayEvent {
    Head { status: u16, mime: String },
    Chunk { text: String },
    End,
    Fail { message: String },
}

fn open() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static OPEN: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    OPEN.get_or_init(|| Mutex::new(HashMap::new()))
}

/// A key is printable, without spaces, and of a sensible length.
pub fn key_ok(key: &str) -> bool {
    key.len() <= 512 && key.chars().all(|c| c.is_ascii_graphic())
}

/// Text that is whole UTF-8 is passed on; a character split across two reads
/// waits for the rest.
fn take_text(pending: &mut Vec<u8>) -> String {
    match std::str::from_utf8(pending) {
        Ok(s) => {
            let out = s.to_string();
            pending.clear();
            out
        }
        Err(e) => {
            let good = e.valid_up_to();
            let out = String::from_utf8_lossy(&pending[..good]).into_owned();
            pending.drain(..good);
            out
        }
    }
}

fn agent() -> Agent {
    let config = Config::builder()
        .tls_config(TlsConfig::builder().provider(TlsProvider::NativeTls).build())
        // A redirect would lead somewhere the table does not name.
        .max_redirects(0)
        .http_status_as_error(false)
        .timeout_connect(Some(Duration::from_secs(10)))
        .timeout_global(Some(Duration::from_secs(15 * 60)))
        .user_agent("Hash LMG")
        .build();
    Agent::new_with_config(config)
}

fn run(url: &str, key: &str, body: Option<String>, stop: &AtomicBool, events: &Channel<RelayEvent>) -> Result<(), String> {
    let agent = agent();
    let auth = (!key.is_empty()).then(|| format!("Bearer {key}"));
    let sent = match body {
        Some(json) => {
            let mut req = agent.post(url).header("Content-Type", "application/json").header("Accept", "text/event-stream, application/json");
            if let Some(a) = &auth {
                req = req.header("Authorization", a);
            }
            req.send(json)
        }
        None => {
            let mut req = agent.get(url).header("Accept", "application/json");
            if let Some(a) = &auth {
                req = req.header("Authorization", a);
            }
            req.call()
        }
    };
    let mut response = sent.map_err(|e| format!("the server did not answer: {e}"))?;
    let mime = response.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    if events.send(RelayEvent::Head { status: response.status().as_u16(), mime }).is_err() {
        return Ok(());
    }
    let mut reader = response.body_mut().with_config().limit(MAX_REPLY).reader();
    let mut buf = vec![0u8; 16 * 1024];
    let mut pending = Vec::new();
    loop {
        if stop.load(Ordering::Relaxed) {
            return Ok(());
        }
        let n = match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                let _ = events.send(RelayEvent::Fail { message: format!("the connection broke part-way through the answer: {e}") });
                return Ok(());
            }
        };
        pending.extend_from_slice(&buf[..n]);
        let text = take_text(&mut pending);
        if !text.is_empty() && events.send(RelayEvent::Chunk { text }).is_err() {
            return Ok(());
        }
    }
    if !pending.is_empty() {
        let _ = events.send(RelayEvent::Chunk { text: String::from_utf8_lossy(&pending).into_owned() });
    }
    let _ = events.send(RelayEvent::End);
    Ok(())
}

/// Sends one request for the page and streams the answer back through `on_event`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn model_relay(provider: String, route: String, port: Option<u16>, key: String, body: Option<String>, request_id: String, on_event: Channel<RelayEvent>) -> Result<(), String> {
    let fail = |message: String| {
        let _ = on_event.send(RelayEvent::Fail { message });
        Ok(())
    };
    let Some(url) = endpoint(&provider, &route, port) else { return fail("The app does not reach that service that way.".into()) };
    if !key_ok(&key) {
        return fail("That key cannot be sent.".into());
    }
    if body.as_ref().is_some_and(|b| b.len() > MAX_BODY) {
        return fail("The request is too large to send.".into());
    }
    if request_id.is_empty() || request_id.len() > 64 || !request_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return fail("The request has no usable name.".into());
    }
    let stop = Arc::new(AtomicBool::new(false));
    open().lock().map_err(|_| "Busy.".to_string())?.insert(request_id.clone(), stop.clone());
    let events = on_event.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || run(&url, &key, body, &stop, &events)).await;
    if let Ok(mut map) = open().lock() {
        map.remove(&request_id);
    }
    match outcome {
        Ok(Ok(())) => Ok(()),
        Ok(Err(message)) => fail(message),
        Err(_) => fail("The request ended unexpectedly.".into()),
    }
}

/// Stops a request this app opened; its answer is dropped at the next read.
#[tauri::command]
pub fn model_relay_cancel(request_id: String) {
    if let Ok(map) = open().lock() {
        if let Some(stop) = map.get(&request_id) {
            stop.store(true, Ordering::Relaxed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_table_is_reached() {
        assert_eq!(endpoint("lmstudio", "chat", Some(1234)).as_deref(), Some("http://127.0.0.1:1234/v1/chat/completions"));
        assert_eq!(endpoint("llamacpp", "models", Some(8080)).as_deref(), Some("http://127.0.0.1:8080/v1/models"));
        assert_eq!(endpoint("moonshot", "chat", None).as_deref(), Some("https://api.moonshot.ai/v1/chat/completions"));
        assert_eq!(endpoint("lmstudio", "chat", Some(22)), None);
        assert_eq!(endpoint("lmstudio", "chat", None), None);
        assert_eq!(endpoint("openai", "chat", None), None);
        assert_eq!(endpoint("moonshot", "files", None), None);
    }

    #[test]
    fn keys_are_plain_text() {
        assert!(key_ok("sk-abc123"));
        assert!(key_ok(""));
        assert!(!key_ok("sk-abc\r\nX-Other: 1"));
        assert!(!key_ok(&"a".repeat(600)));
    }

    #[test]
    fn split_characters_wait_for_the_rest() {
        let bytes = "é".as_bytes();
        let mut pending = vec![b'a', bytes[0]];
        assert_eq!(take_text(&mut pending), "a");
        pending.push(bytes[1]);
        assert_eq!(take_text(&mut pending), "é");
    }
}
