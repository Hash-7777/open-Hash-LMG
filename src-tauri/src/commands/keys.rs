// Keys for cloud services, kept by this side alone.
//
// The page hands a key over once, when the person types it in Settings, and
// never sees it again: no command returns one. Every request to a cloud
// service goes through the relay (relay.rs), which adds the key for that one
// service on the way out, in that service's own header. So nothing the page
// runs, and nothing a model writes, can read a key back.
//
// The keys live in one file in the app's own data folder. On macOS and Linux
// the folder and the file are made readable by this account alone. The page
// learns only which services have a key and the key's last four characters,
// so Settings can say which key is saved.

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Every service a key may be kept for: the cloud model services in
/// src/core/providers/catalog.js and the search service in
/// src/core/research/search.js. scripts/checks/policy.mjs holds the lists together.
pub const SERVICES: &[&str] = &[
    "anthropic", "openai", "gemini", "openrouter", "groq", "deepseek", "mistral", "xai", "moonshot", "together", "fireworks", "cerebras", "tavily",
];

const FILE: &str = "keys.json";
const MAX_KEY: usize = 512;
static LOCK: Mutex<()> = Mutex::new(());

/// A key is printable, without spaces or line breaks, and of a sensible length.
pub fn key_ok(key: &str) -> bool {
    !key.is_empty() && key.len() <= MAX_KEY && key.chars().all(|c| c.is_ascii_graphic())
}

pub fn service_ok(service: &str) -> bool {
    SERVICES.contains(&service)
}

/// What the page is told about a saved key: its last four characters, or no
/// characters at all for a key too short to show any of safely.
pub fn hint(key: &str) -> String {
    if key.len() >= 12 {
        format!("ends in {}", &key[key.len() - 4..])
    } else {
        "saved".into()
    }
}

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("The app's folder could not be found: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("The app's folder could not be made: {e}"))?;
    private(&dir, 0o700);
    Ok(dir.join(FILE))
}

#[cfg(unix)]
fn private(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(mode));
}
#[cfg(not(unix))]
fn private(_path: &Path, _mode: u32) {}

/// The saved keys, with anything that is not a known service's valid key left out.
pub fn read_from(file: &Path) -> BTreeMap<String, String> {
    let raw = fs::read_to_string(file).unwrap_or_default();
    let map: BTreeMap<String, String> = serde_json::from_str(&raw).unwrap_or_default();
    map.into_iter().filter(|(k, v)| service_ok(k) && key_ok(v)).collect()
}

/// Writes beside the file, readable by this account alone, then renames over it.
pub fn write_to(file: &Path, keys: &BTreeMap<String, String>) -> Result<(), String> {
    let tmp = file.with_extension("json.partial");
    let body = serde_json::to_vec(keys).map_err(|e| e.to_string())?;
    {
        let mut opts = fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts.open(&tmp).map_err(|e| format!("The key could not be saved: {e}"))?;
        f.write_all(&body).and_then(|_| f.sync_all()).map_err(|e| format!("The key could not be saved: {e}"))?;
    }
    private(&tmp, 0o600);
    fs::rename(&tmp, file).map_err(|e| format!("The key could not be saved: {e}"))
}

/// The key for one service, for the relay to send; never for the page.
pub fn lookup(app: &AppHandle, service: &str) -> Option<String> {
    let _guard = LOCK.lock().ok()?;
    read_from(&path(app).ok()?).remove(service)
}

fn status_of(keys: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    keys.iter().map(|(k, v)| (k.clone(), hint(v))).collect()
}

/// Which services have a key, each with its hint. Never a key.
#[tauri::command]
pub fn keys_status(app: AppHandle) -> Result<BTreeMap<String, String>, String> {
    let _guard = LOCK.lock().map_err(|_| "Busy.".to_string())?;
    Ok(status_of(&read_from(&path(&app)?)))
}

/// Saves the key for one service, or forgets it when the key is empty.
/// Answers with the new status, never with the key.
#[tauri::command]
pub fn key_set(app: AppHandle, service: String, key: String) -> Result<BTreeMap<String, String>, String> {
    if !service_ok(&service) {
        return Err("The app keeps no key for that service.".into());
    }
    let key = key.trim().to_string();
    if !key.is_empty() && !key_ok(&key) {
        return Err("That key has spaces, line breaks or characters a key never has. Copy it again from the service's page.".into());
    }
    let _guard = LOCK.lock().map_err(|_| "Busy.".to_string())?;
    let file = path(&app)?;
    let mut keys = read_from(&file);
    if key.is_empty() {
        keys.remove(&service);
    } else {
        keys.insert(service, key);
    }
    write_to(&file, &keys)?;
    Ok(status_of(&keys))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hash-lmg-keys-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.join(FILE)
    }

    #[test]
    fn only_known_services_and_plain_keys_are_kept() {
        assert!(service_ok("openai") && service_ok("tavily"));
        assert!(!service_ok("ollama") && !service_ok("../x") && !service_ok(""));
        assert!(key_ok("sk-test-abcdef123456"));
        assert!(!key_ok("") && !key_ok("has space") && !key_ok("line\nbreak") && !key_ok(&"a".repeat(MAX_KEY + 1)));
    }

    #[test]
    fn a_hint_shows_at_most_the_last_four() {
        assert_eq!(hint("sk-test-abcdef123456"), "ends in 3456");
        assert_eq!(hint("short"), "saved");
    }

    #[test]
    fn keys_round_trip_and_bad_entries_are_dropped() {
        let file = scratch("round");
        let mut keys = BTreeMap::new();
        keys.insert("openai".to_string(), "sk-test-abcdef123456".to_string());
        write_to(&file, &keys).unwrap();
        assert_eq!(read_from(&file), keys);
        fs::write(&file, r#"{"openai":"sk-test-abcdef123456","nobody":"x-123","groq":"two words"}"#).unwrap();
        assert_eq!(read_from(&file), keys);
        let _ = fs::remove_dir_all(file.parent().unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn the_file_is_readable_by_this_account_alone() {
        use std::os::unix::fs::PermissionsExt;
        let file = scratch("mode");
        write_to(&file, &BTreeMap::new()).unwrap();
        assert_eq!(fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
        let _ = fs::remove_dir_all(file.parent().unwrap());
    }

    #[test]
    fn the_status_never_carries_a_key() {
        let mut keys = BTreeMap::new();
        keys.insert("groq".to_string(), "gsk-test-abcdef123456".to_string());
        let status = serde_json::to_string(&status_of(&keys)).unwrap();
        assert!(!status.contains("abcdef"));
        assert!(status.contains("3456"));
    }
}
