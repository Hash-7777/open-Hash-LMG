// Writing an export where the person chooses.
//
// The page renders and encodes the film itself; this side only asks the
// system's save dialog for a place and writes the bytes there. The page never
// sees or names the path: it gets back a token for the open file, sends the
// film in slices under that token, and ends it. A cancelled or failed export
// leaves nothing behind.

use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::fs::File;
use std::hash::{BuildHasher, Hasher};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

pub struct Open {
    file: File,
    path: PathBuf,
}

#[derive(Default)]
pub struct Exports(Mutex<HashMap<String, Open>>);

static COUNTER: AtomicU64 = AtomicU64::new(1);

fn token() -> String {
    let mut h = RandomState::new().build_hasher();
    h.write_u64(COUNTER.fetch_add(1, Ordering::Relaxed));
    format!("{:016x}", h.finish())
}

const KINDS: [(&str, &str); 4] = [("mp4", "MP4 video"), ("mov", "QuickTime movie"), ("wav", "WAV sound"), ("png", "PNG picture")];

/// A file name the dialog can suggest: no folders, no hidden or odd
/// characters, and one of the kinds the app writes.
pub fn safe_name(name: &str) -> (String, &'static str, &'static str) {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let clean: String = base.chars().filter(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | ' ')).take(80).collect();
    let clean = clean.trim_start_matches('.').trim().to_string();
    let ext = clean.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    let (kind, label) = KINDS.iter().find(|(k, _)| *k == ext).copied().unwrap_or(("mp4", "MP4 video"));
    let stem = clean.rsplit_once('.').map(|(s, _)| s.to_string()).unwrap_or(clean.clone());
    let stem = if stem.trim().is_empty() { "film".to_string() } else { stem };
    (format!("{stem}.{kind}"), kind, label)
}

#[tauri::command]
pub async fn export_begin(app: AppHandle, exports: State<'_, Exports>, name: String) -> Result<Option<String>, String> {
    let (suggested, kind, label) = safe_name(&name);
    let picked = app.dialog().file().set_file_name(&suggested).add_filter(label, &[kind]).blocking_save_file();
    let Some(picked) = picked else { return Ok(None) };
    let path = picked.into_path().map_err(|e| format!("That place cannot be written to: {e}"))?;
    let file = File::create(&path).map_err(|e| format!("The file could not be made there: {e}"))?;
    let t = token();
    exports.0.lock().map_err(|_| "Busy.".to_string())?.insert(t.clone(), Open { file, path });
    Ok(Some(t))
}

#[tauri::command]
pub fn export_chunk(exports: State<'_, Exports>, request: Request<'_>) -> Result<(), String> {
    let t = request.headers().get("x-export-token").and_then(|v| v.to_str().ok()).ok_or("The export was not started.")?.to_string();
    let InvokeBody::Raw(bytes) = request.body() else { return Err("The export sent something that is not a film.".into()) };
    let mut map = exports.0.lock().map_err(|_| "Busy.".to_string())?;
    let open = map.get_mut(&t).ok_or("The export was not started.")?;
    open.file.write_all(bytes).map_err(|e| format!("The file could not be written: {e}"))
}

#[tauri::command]
pub fn export_end(exports: State<'_, Exports>, token: String, ok: bool) -> Result<(), String> {
    let open = exports.0.lock().map_err(|_| "Busy.".to_string())?.remove(&token);
    let Some(mut open) = open else { return Ok(()) };
    let flushed = open.file.flush().and_then(|_| open.file.sync_all());
    drop(open.file);
    if !ok || flushed.is_err() {
        let _ = std::fs::remove_file(&open.path);
    }
    flushed.map_err(|e| format!("The file could not be finished: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_keep_only_a_file_name_of_a_known_kind() {
        assert_eq!(safe_name("Harbor-Notes.mp4").0, "Harbor-Notes.mp4");
        assert_eq!(safe_name("film.MOV").0, "film.mov");
        assert_eq!(safe_name("../../somewhere/film.mp4").0, "film.mp4");
        assert_eq!(safe_name("C:\\x\\film.wav").0, "film.wav");
        assert_eq!(safe_name(".hidden.mp4").0, "hidden.mp4");
        assert_eq!(safe_name("film.exe").0, "film.mp4");
        assert_eq!(safe_name("").0, "film.mp4");
        assert_eq!(safe_name("a\u{0}b.mp4").0, "ab.mp4");
    }

    #[test]
    fn tokens_differ() {
        assert_ne!(token(), token());
    }
}
