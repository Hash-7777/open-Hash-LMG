// Footage, pictures and sound brought into a film.
//
// The person picks files in the system's own open dialog, or drops them on
// the window, where the drop is read here (lib.rs); the page never sees or
// names a path. Each file is remembered by an id in a small list in the
// app's data folder, and stays where it is, as a video editor links to its
// media rather than copying it. The window reads a file through the app's own
// address, lmgmedia, by id, in pieces of the size it asks for, so a long video
// is never read whole into memory.

use serde::{Deserialize, Serialize};
use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::fs::{self, File};
use std::hash::{BuildHasher, Hasher};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::DialogExt;

const LIST: &str = "media.json";
// The most a single answer carries: enough for smooth playback, small enough
// that seeking a long video stays cheap.
const PIECE: u64 = 4 * 1024 * 1024;
// A whole file is sent only up to this size, for sound read in one go.
const WHOLE: u64 = 256 * 1024 * 1024;
static LOCK: Mutex<()> = Mutex::new(());
static COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Item {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub size: u64,
    pub mime: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct Kept {
    path: PathBuf,
    item: Item,
}

// The kinds of file a film takes, by extension: what it is and how it is served.
pub fn kind_of(name: &str) -> Option<(&'static str, &'static str)> {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase())?;
    Some(match ext.as_str() {
        "mp4" | "m4v" => ("video", "video/mp4"),
        "mov" => ("video", "video/quicktime"),
        "webm" => ("video", "video/webm"),
        "mkv" => ("video", "video/x-matroska"),
        "png" => ("image", "image/png"),
        "jpg" | "jpeg" => ("image", "image/jpeg"),
        "webp" => ("image", "image/webp"),
        "gif" => ("image", "image/gif"),
        "mp3" => ("sound", "audio/mpeg"),
        "wav" => ("sound", "audio/wav"),
        "m4a" | "aac" => ("sound", "audio/mp4"),
        "flac" => ("sound", "audio/flac"),
        "ogg" | "oga" => ("sound", "audio/ogg"),
        "opus" => ("sound", "audio/ogg"),
        _ => return None,
    })
}

/// Ids are 24 lower-case hex digits; nothing else names a file.
pub fn valid_id(id: &str) -> bool {
    id.len() == 24 && id.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

fn new_id() -> String {
    let mut out = String::new();
    for _ in 0..2 {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(COUNTER.fetch_add(1, Ordering::Relaxed));
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out[..24].to_string()
}

fn list_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("The app's folder could not be found: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("The app's folder could not be made: {e}"))?;
    Ok(dir.join(LIST))
}

fn read_list(path: &Path) -> HashMap<String, Kept> {
    fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn write_list(path: &Path, list: &HashMap<String, Kept>) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    let body = serde_json::to_vec(list).map_err(|e| e.to_string())?;
    fs::write(&tmp, body).and_then(|_| fs::rename(&tmp, path)).map_err(|e| format!("The media list could not be saved: {e}"))
}

/// Opens the system's dialog for footage, pictures and sound, and remembers
/// each file chosen. Answers with what was taken; files of other kinds are left.
#[tauri::command]
pub async fn media_import(app: AppHandle) -> Result<Vec<Item>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Footage, pictures and sound", &["mp4", "m4v", "mov", "webm", "mkv", "png", "jpg", "jpeg", "webp", "gif", "mp3", "wav", "m4a", "aac", "flac", "ogg", "oga", "opus"])
        .blocking_pick_files();
    let Some(picked) = picked else { return Ok(Vec::new()) };
    remember(&app, picked.into_iter().filter_map(|p| p.into_path().ok()).collect())
}

/// Remembers files the person chose or dropped on the window, keeping only
/// files of the kinds a film takes; answers with what was taken. The same file
/// again keeps its id.
pub fn remember<R: Runtime>(app: &AppHandle<R>, files: Vec<PathBuf>) -> Result<Vec<Item>, String> {
    let _g = LOCK.lock().map_err(|_| "Busy.".to_string())?;
    let path = list_path(app)?;
    let mut list = read_list(&path);
    let mut out = Vec::new();
    for file in files.into_iter().take(50) {
        let name = file.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let Some((kind, mime)) = kind_of(&name) else { continue };
        let Ok(meta) = fs::metadata(&file) else { continue };
        if !meta.is_file() {
            continue;
        }
        if let Some(k) = list.values().find(|k| k.path == file) {
            out.push(k.item.clone());
            continue;
        }
        let item = Item { id: new_id(), name: name.chars().take(200).collect(), kind: kind.into(), size: meta.len(), mime: mime.into() };
        list.insert(item.id.clone(), Kept { path: file, item: item.clone() });
        out.push(item);
    }
    if !out.is_empty() {
        write_list(&path, &list)?;
    }
    Ok(out)
}

/// The file kept under an id, if it is still where it was.
fn locate<R: Runtime>(app: &AppHandle<R>, id: &str) -> Option<(PathBuf, Item)> {
    if !valid_id(id) {
        return None;
    }
    let list = read_list(&list_path(app).ok()?);
    let k = list.get(id)?;
    k.path.is_file().then(|| (k.path.clone(), k.item.clone()))
}

/// The bytes a range header asks for, as (start, end inclusive), within a file
/// of `size` bytes and at most one piece long.
pub fn range_of(value: Option<&str>, size: u64) -> Option<(u64, u64)> {
    let spec = value?.trim().strip_prefix("bytes=")?;
    let (a, b) = spec.split(',').next()?.split_once('-')?;
    let (start, end) = match (a.trim(), b.trim()) {
        ("", n) => {
            let n: u64 = n.parse().ok()?;
            (size.saturating_sub(n), size.saturating_sub(1))
        }
        (s, "") => (s.parse().ok()?, size.saturating_sub(1)),
        (s, e) => (s.parse().ok()?, e.parse::<u64>().ok()?.min(size.saturating_sub(1))),
    };
    if size == 0 || start > end || start >= size {
        return None;
    }
    Some((start, end.min(start + PIECE - 1)))
}

fn answer(status: StatusCode, mime: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        // The window draws footage into its canvas, which a picture from
        // another address would otherwise make unreadable for export.
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(body)
        .unwrap_or_default()
}

/// Serves lmgmedia://localhost/<id> (http://lmgmedia.localhost/<id> on Windows).
pub fn serve<R: Runtime>(app: &AppHandle<R>, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let id = request.uri().path().trim_start_matches('/');
    let Some((path, item)) = locate(app, id) else { return answer(StatusCode::NOT_FOUND, "text/plain", b"That file is not there any more.".to_vec()) };
    let Ok(mut file) = File::open(&path) else { return answer(StatusCode::NOT_FOUND, "text/plain", b"That file could not be opened.".to_vec()) };
    let size = file.metadata().map(|m| m.len()).unwrap_or(0);
    let asked = request.headers().get(header::RANGE).and_then(|v| v.to_str().ok());
    if asked.is_none() {
        if size > WHOLE {
            return answer(StatusCode::PAYLOAD_TOO_LARGE, "text/plain", b"Read this file in pieces.".to_vec());
        }
        let mut body = Vec::with_capacity(size as usize);
        return match file.read_to_end(&mut body) {
            Ok(_) => answer(StatusCode::OK, &item.mime, body),
            Err(_) => answer(StatusCode::INTERNAL_SERVER_ERROR, "text/plain", b"The file could not be read.".to_vec()),
        };
    }
    let Some((start, end)) = range_of(asked, size) else {
        let mut r = answer(StatusCode::RANGE_NOT_SATISFIABLE, "text/plain", Vec::new());
        if let Ok(v) = format!("bytes */{size}").parse() {
            r.headers_mut().insert(header::CONTENT_RANGE, v);
        }
        return r;
    };
    let mut body = vec![0u8; (end - start + 1) as usize];
    if file.seek(SeekFrom::Start(start)).and_then(|_| file.read_exact(&mut body)).is_err() {
        return answer(StatusCode::INTERNAL_SERVER_ERROR, "text/plain", b"The file could not be read.".to_vec());
    }
    let mut r = answer(StatusCode::PARTIAL_CONTENT, &item.mime, body);
    if let Ok(v) = format!("bytes {start}-{end}/{size}").parse() {
        r.headers_mut().insert(header::CONTENT_RANGE, v);
    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_come_from_the_extension() {
        assert_eq!(kind_of("Clip.MOV"), Some(("video", "video/quicktime")));
        assert_eq!(kind_of("song.mp3"), Some(("sound", "audio/mpeg")));
        assert_eq!(kind_of("logo.png"), Some(("image", "image/png")));
        assert_eq!(kind_of("notes.txt"), None);
        assert_eq!(kind_of("noextension"), None);
    }

    #[test]
    fn ids_are_hex_of_one_length() {
        let id = new_id();
        assert!(valid_id(&id));
        assert_ne!(new_id(), new_id());
        assert!(!valid_id("../../etc/passwd"));
        assert!(!valid_id("ABCDEF0123456789abcdef01"));
        assert!(!valid_id("abc"));
    }

    #[test]
    fn ranges_are_read_within_the_file_and_one_piece() {
        assert_eq!(range_of(Some("bytes=0-99"), 1000), Some((0, 99)));
        assert_eq!(range_of(Some("bytes=900-"), 1000), Some((900, 999)));
        assert_eq!(range_of(Some("bytes=-100"), 1000), Some((900, 999)));
        assert_eq!(range_of(Some("bytes=0-"), 100 * 1024 * 1024), Some((0, PIECE - 1)));
        assert_eq!(range_of(Some("bytes=500-9999"), 1000), Some((500, 999)));
        assert_eq!(range_of(Some("bytes=2000-"), 1000), None);
        assert_eq!(range_of(Some("pages=1-2"), 1000), None);
        assert_eq!(range_of(None, 1000), None);
    }
}
