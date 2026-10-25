// Model servers, asked by this side for the page.
//
// In the desktop app the page reaches no host on the internet itself: its
// content policy names none. Every request to a cloud model service, and to
// a model app on this computer that refuses a web page, is made here.
//
// The page names a service and a route ("chat", "models", "speech"), and for
// an app on this computer a port, and for a service that puts the model in
// the address the model's name; the address comes from the table below, with
// no part of it written by the page. The key is added here, from the keys
// this side keeps (keys.rs), in that service's own header, for that one host.
// The page never sends a key and never gets one back.
//
// The reply streams back through a channel as it arrives, in order: a head,
// chunks of text, then an end, or a failure in plain words instead. Speech
// comes back whole, as the bytes of the sound.

use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::ipc::{Channel, Response};
use tauri::AppHandle;
use ureq::config::Config;
use ureq::tls::{TlsConfig, TlsProvider};
use ureq::Agent;

use super::keys;

const MAX_BODY: usize = 8 * 1024 * 1024;
const MAX_REPLY: u64 = 64 * 1024 * 1024;
const MAX_SOUND: u64 = 32 * 1024 * 1024;

/// How a service is told whose key it is.
#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Auth {
    None,
    Bearer,
    Anthropic,
    Google,
}

#[derive(Debug, PartialEq)]
pub struct Target {
    pub url: String,
    pub auth: Auth,
    /// The service the key belongs to, when one is sent.
    pub service: &'static str,
    /// Headers every request to this service carries; never a key.
    pub fixed: &'static [(&'static str, &'static str)],
}

/// Cloud services that speak the common chat shape: id, chat path and model
/// list path under one host.
const CHAT_SHAPE: &[(&str, &str, &str, &str)] = &[
    ("openai", "https://api.openai.com", "/v1/chat/completions", "/v1/models"),
    ("openrouter", "https://openrouter.ai", "/api/v1/chat/completions", "/api/v1/models"),
    ("groq", "https://api.groq.com", "/openai/v1/chat/completions", "/openai/v1/models"),
    ("deepseek", "https://api.deepseek.com", "/v1/chat/completions", "/v1/models"),
    ("mistral", "https://api.mistral.ai", "/v1/chat/completions", "/v1/models"),
    ("xai", "https://api.x.ai", "/v1/chat/completions", "/v1/models"),
    ("moonshot", "https://api.moonshot.ai", "/v1/chat/completions", "/v1/models"),
    ("together", "https://api.together.xyz", "/v1/chat/completions", "/v1/models"),
    ("fireworks", "https://api.fireworks.ai", "/inference/v1/chat/completions", "/inference/v1/models"),
    ("cerebras", "https://api.cerebras.ai", "/v1/chat/completions", "/v1/models"),
];

/// A model name that may go into an address: letters, digits, dot, dash,
/// underscore, at most 128 long.
pub fn model_ok(model: &str) -> bool {
    !model.is_empty() && model.len() <= 128 && model.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

/// Every address this file can reach. A page's request picks a row; it never
/// builds one.
pub fn endpoint(provider: &str, route: &str, port: Option<u16>, model: Option<&str>) -> Option<Target> {
    let local = |path: &str| {
        port.filter(|p| *p >= 1024).map(|p| Target { url: format!("http://127.0.0.1:{p}{path}"), auth: Auth::None, service: "", fixed: &[] })
    };
    match (provider, route) {
        ("lmstudio" | "llamacpp", "chat") => return local("/v1/chat/completions"),
        ("lmstudio" | "llamacpp", "models") => return local("/v1/models"),
        ("anthropic", "chat" | "models") => {
            let path = if route == "chat" { "/v1/messages" } else { "/v1/models?limit=100" };
            return Some(Target { url: format!("https://api.anthropic.com{path}"), auth: Auth::Anthropic, service: "anthropic", fixed: &[("anthropic-version", "2023-06-01")] });
        }
        ("gemini", "models") => {
            return Some(Target { url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200".into(), auth: Auth::Google, service: "gemini", fixed: &[] });
        }
        ("gemini", "chat" | "chat-once") => {
            let m = model.map(|m| m.trim_start_matches("models/")).filter(|m| model_ok(m))?;
            let action = if route == "chat" { "streamGenerateContent?alt=sse" } else { "generateContent" };
            return Some(Target { url: format!("https://generativelanguage.googleapis.com/v1beta/models/{m}:{action}"), auth: Auth::Google, service: "gemini", fixed: &[] });
        }
        ("openai", "speech") => {
            return Some(Target { url: "https://api.openai.com/v1/audio/speech".into(), auth: Auth::Bearer, service: "openai", fixed: &[] });
        }
        _ => {}
    }
    let (id, host, chat, models) = CHAT_SHAPE.iter().find(|(id, ..)| *id == provider)?;
    let path = match route {
        "chat" | "chat-once" => chat,
        "models" => models,
        _ => return None,
    };
    let fixed: &'static [(&'static str, &'static str)] = if *id == "openrouter" { &[("X-Title", "Hash LMG")] } else { &[] };
    Some(Target { url: format!("{host}{path}"), auth: Auth::Bearer, service: id, fixed })
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

/// A request with the target's fixed headers and, when it takes one, the key
/// in that service's own header.
fn decorate<B>(mut req: ureq::RequestBuilder<B>, target: &Target, key: &str) -> ureq::RequestBuilder<B> {
    for (k, v) in target.fixed {
        req = req.header(*k, *v);
    }
    if key.is_empty() {
        return req;
    }
    match target.auth {
        Auth::Bearer => req.header("Authorization", format!("Bearer {key}")),
        Auth::Anthropic => req.header("x-api-key", key),
        Auth::Google => req.header("x-goog-api-key", key),
        Auth::None => req,
    }
}

fn request(agent: &Agent, target: &Target, key: &str, body: Option<String>, accept: &str) -> Result<ureq::http::Response<ureq::Body>, ureq::Error> {
    match body {
        Some(json) => decorate(agent.post(&target.url).header("Content-Type", "application/json").header("Accept", accept), target, key).send(json),
        None => decorate(agent.get(&target.url).header("Accept", "application/json"), target, key).call(),
    }
}

/// The key a target needs, from the keys this side keeps.
fn key_for(app: &AppHandle, target: &Target) -> Result<String, String> {
    if target.auth == Auth::None {
        return Ok(String::new());
    }
    keys::lookup(app, target.service).ok_or_else(|| "There is no key saved for that service. Add it in Settings, under Cloud keys.".to_string())
}

fn run(target: &Target, key: &str, body: Option<String>, stop: &AtomicBool, events: &Channel<RelayEvent>) -> Result<(), String> {
    let sent = request(&agent(), target, key, body, "text/event-stream, application/json");
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
pub async fn model_relay(app: AppHandle, provider: String, route: String, port: Option<u16>, model: Option<String>, body: Option<String>, request_id: String, on_event: Channel<RelayEvent>) -> Result<(), String> {
    let fail = |message: String| {
        let _ = on_event.send(RelayEvent::Fail { message });
        Ok(())
    };
    if route == "speech" {
        return fail("The app does not reach that service that way.".into());
    }
    let Some(target) = endpoint(&provider, &route, port, model.as_deref()) else { return fail("The app does not reach that service that way.".into()) };
    if body.as_ref().is_some_and(|b| b.len() > MAX_BODY) {
        return fail("The request is too large to send.".into());
    }
    if request_id.is_empty() || request_id.len() > 64 || !request_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return fail("The request has no usable name.".into());
    }
    let key = match key_for(&app, &target) {
        Ok(k) => k,
        Err(message) => return fail(message),
    };
    let stop = Arc::new(AtomicBool::new(false));
    open().lock().map_err(|_| "Busy.".to_string())?.insert(request_id.clone(), stop.clone());
    let events = on_event.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || run(&target, &key, body, &stop, &events)).await;
    if let Ok(mut map) = open().lock() {
        map.remove(&request_id);
    }
    match outcome {
        Ok(Ok(())) => Ok(()),
        Ok(Err(message)) => fail(message),
        Err(_) => fail("The request ended unexpectedly.".into()),
    }
}

/// One line spoken by a cloud voice: the request body in, the sound's bytes out.
#[tauri::command]
pub async fn speech_relay(app: AppHandle, provider: String, body: String) -> Result<Response, String> {
    let target = endpoint(&provider, "speech", None, None).ok_or("The app does not reach that service that way.")?;
    if body.len() > MAX_BODY {
        return Err("The request is too large to send.".into());
    }
    let key = key_for(&app, &target)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let mut response = request(&agent(), &target, &key, Some(body), "audio/wav, application/json").map_err(|e| format!("the voice service did not answer: {e}"))?;
        let status = response.status().as_u16();
        let mut out = Vec::new();
        response.body_mut().with_config().limit(MAX_SOUND).reader().read_to_end(&mut out).map_err(|e| format!("the sound did not arrive whole: {e}"))?;
        if status >= 400 {
            return Err(format!("The voice service answered with an error ({status})."));
        }
        Ok(out)
    })
    .await
    .map_err(|_| "The request ended unexpectedly.".to_string())??;
    Ok(Response::new(bytes))
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
        let url = |p: &str, r: &str, port: Option<u16>, m: Option<&str>| endpoint(p, r, port, m).map(|t| t.url);
        assert_eq!(url("lmstudio", "chat", Some(1234), None).as_deref(), Some("http://127.0.0.1:1234/v1/chat/completions"));
        assert_eq!(url("llamacpp", "models", Some(8080), None).as_deref(), Some("http://127.0.0.1:8080/v1/models"));
        assert_eq!(url("moonshot", "chat", None, None).as_deref(), Some("https://api.moonshot.ai/v1/chat/completions"));
        assert_eq!(url("openai", "chat", None, None).as_deref(), Some("https://api.openai.com/v1/chat/completions"));
        assert_eq!(url("anthropic", "chat", None, None).as_deref(), Some("https://api.anthropic.com/v1/messages"));
        assert_eq!(url("openai", "speech", None, None).as_deref(), Some("https://api.openai.com/v1/audio/speech"));
        assert_eq!(url("lmstudio", "chat", Some(22), None), None);
        assert_eq!(url("lmstudio", "chat", None, None), None);
        assert_eq!(url("ollama", "chat", Some(11434), None), None);
        assert_eq!(url("moonshot", "files", None, None), None);
        assert_eq!(url("groq", "speech", None, None), None);
    }

    #[test]
    fn a_model_in_the_address_is_a_plain_name() {
        assert_eq!(
            endpoint("gemini", "chat", None, Some("gemini-2.5-flash")).map(|t| t.url).as_deref(),
            Some("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse")
        );
        for bad in ["", "../x", "a/b", "a?b=c", "has space", "a#b"] {
            assert!(endpoint("gemini", "chat", None, Some(bad)).is_none(), "accepted {bad:?}");
        }
        assert!(endpoint("gemini", "chat", None, None).is_none());
    }

    #[test]
    fn each_service_is_told_whose_key_it_is_in_its_own_way() {
        assert_eq!(endpoint("anthropic", "chat", None, None).unwrap().auth, Auth::Anthropic);
        assert_eq!(endpoint("gemini", "models", None, None).unwrap().auth, Auth::Google);
        assert_eq!(endpoint("deepseek", "chat", None, None).unwrap().auth, Auth::Bearer);
        assert_eq!(endpoint("lmstudio", "chat", Some(1234), None).unwrap().auth, Auth::None);
        // The key a target takes is the one kept for its own service.
        for (id, ..) in CHAT_SHAPE {
            assert_eq!(endpoint(id, "chat", None, None).unwrap().service, *id);
            assert!(keys::service_ok(id));
        }
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
