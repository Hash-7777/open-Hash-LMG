// Films kept on this computer, one JSON file each, in the app's own data
// folder (keyed by the bundle identifier). The page names a film by its id
// and nothing else; this side decides where it lives.
//
// A small index beside the films holds each one's title and when it last
// changed, so the list opens without reading every film, some of which carry
// spoken clips and pictures inside them. A damaged or missing index is rebuilt
// from the films themselves.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const MAX_BYTES: usize = 512 * 1024 * 1024;
const INDEX: &str = "index.json";
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Entry {
    pub id: String,
    pub title: String,
    pub updated: u64,
}

/// Ids look like `film-lq3k2a-9xk1`: lower-case letters, digits and dashes,
/// starting with a letter or digit, at most 64 long. Nothing else can become
/// part of a file name.
pub fn valid_id(id: &str) -> bool {
    let b = id.as_bytes();
    !b.is_empty()
        && b.len() <= 64
        && (b[0].is_ascii_lowercase() || b[0].is_ascii_digit())
        && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}

pub fn clean_title(title: &str) -> String {
    let t: String = title.chars().filter(|c| !c.is_control()).collect::<String>().trim().chars().take(120).collect();
    if t.is_empty() { "Untitled film".to_string() } else { t }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn folder(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("The app's folder could not be found: {e}"))?.join("projects");
    fs::create_dir_all(&dir).map_err(|e| format!("The films folder could not be made: {e}"))?;
    Ok(dir)
}

fn file_of(dir: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("That film name cannot be used.".into());
    }
    Ok(dir.join(format!("{id}.json")))
}

// Writes beside the target, then renames over it, so a film is never left
// half written if the app stops in the middle.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("json.partial");
    let mut f = fs::File::create(&tmp).map_err(|e| format!("The film could not be saved: {e}"))?;
    f.write_all(bytes).and_then(|_| f.sync_all()).map_err(|e| format!("The film could not be saved: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| format!("The film could not be saved: {e}"))
}

fn rebuild_index(dir: &Path) -> Vec<Entry> {
    let mut out = Vec::new();
    let Ok(rd) = fs::read_dir(dir) else { return out };
    for e in rd.flatten() {
        let p = e.path();
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        let Some(id) = name.strip_suffix(".json") else { continue };
        if name == INDEX || !valid_id(id) { continue; }
        let title = fs::read_to_string(&p)
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|v| v.pointer("/scene/title").and_then(|t| t.as_str()).map(clean_title))
            .unwrap_or_else(|| "Untitled film".into());
        let updated = e.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
        out.push(Entry { id: id.to_string(), title, updated });
    }
    out
}

fn read_index(dir: &Path) -> Vec<Entry> {
    let parsed = fs::read_to_string(dir.join(INDEX)).ok().and_then(|s| serde_json::from_str::<Vec<Entry>>(&s).ok());
    match parsed {
        Some(list) => list.into_iter().filter(|e| valid_id(&e.id) && dir.join(format!("{}.json", e.id)).exists()).collect(),
        None => rebuild_index(dir),
    }
}

fn save_index(dir: &Path, list: &[Entry]) -> Result<(), String> {
    let bytes = serde_json::to_vec(list).map_err(|e| e.to_string())?;
    let path = dir.join(INDEX);
    let tmp = dir.join("index.json.partial");
    fs::write(&tmp, bytes).and_then(|_| fs::rename(&tmp, &path)).map_err(|e| format!("The list of films could not be saved: {e}"))
}

#[tauri::command]
pub fn project_list(app: AppHandle) -> Result<Vec<Entry>, String> {
    let _g = LOCK.lock().map_err(|_| "Busy.".to_string())?;
    let dir = folder(&app)?;
    Ok(read_index(&dir))
}

#[tauri::command]
pub fn project_read(app: AppHandle, id: String) -> Result<String, String> {
    let dir = folder(&app)?;
    let path = file_of(&dir, &id)?;
    fs::read_to_string(&path).map_err(|_| "That film is not there any more.".to_string())
}

#[tauri::command]
pub fn project_write(app: AppHandle, id: String, title: String, content: String) -> Result<bool, String> {
    if content.len() > MAX_BYTES {
        return Err("This film is too large to save.".into());
    }
    if serde_json::from_str::<serde_json::Value>(&content).map(|v| !v.is_object()).unwrap_or(true) {
        return Err("The film was not in a form that can be saved.".into());
    }
    let _g = LOCK.lock().map_err(|_| "Busy.".to_string())?;
    let dir = folder(&app)?;
    let path = file_of(&dir, &id)?;
    write_atomic(&path, content.as_bytes())?;
    let mut list = read_index(&dir);
    list.retain(|e| e.id != id);
    list.push(Entry { id, title: clean_title(&title), updated: now_ms() });
    save_index(&dir, &list)?;
    Ok(true)
}

#[tauri::command]
pub fn project_delete(app: AppHandle, id: String) -> Result<bool, String> {
    let _g = LOCK.lock().map_err(|_| "Busy.".to_string())?;
    let dir = folder(&app)?;
    let path = file_of(&dir, &id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("The film could not be deleted: {e}"))?;
    }
    let mut list = read_index(&dir);
    list.retain(|e| e.id != id);
    save_index(&dir, &list)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_plain_names() {
        for ok in ["film-lq3k2a-9xk1", "a", "0abc", "film-1"] {
            assert!(valid_id(ok), "{ok} should be accepted");
        }
        let long = "a".repeat(65);
        for bad in ["", "-film", "Film", "film_1", "film.json", "../film", "film/1", "film 1", "fi\u{0}lm", long.as_str()] {
            assert!(!valid_id(bad), "{bad:?} should be refused");
        }
    }

    #[test]
    fn titles_are_trimmed_and_never_empty() {
        assert_eq!(clean_title("  A film \n"), "A film");
        assert_eq!(clean_title(""), "Untitled film");
        assert_eq!(clean_title(&"x".repeat(300)).chars().count(), 120);
    }

    #[test]
    fn the_index_is_rebuilt_from_the_films() {
        let dir = std::env::temp_dir().join(format!("hash-lmg-test-{}", now_ms()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("film-a.json"), r#"{"scene":{"title":"First"}}"#).unwrap();
        fs::write(dir.join("not a film.json"), "{}").unwrap();
        fs::write(dir.join(INDEX), "damaged").unwrap();
        let list = read_index(&dir);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "film-a");
        assert_eq!(list[0].title, "First");
        fs::remove_dir_all(&dir).unwrap();
    }
}
