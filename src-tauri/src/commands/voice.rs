// Voices installed on this computer, for narration.
//
// Chatterbox and Kokoro run through the person's own Python install. The
// person points the app at that install's folder once, in the system's own
// folder dialog, and the app remembers it; the page names an engine, never a
// path. Each line is spoken by a short script built into the app
// (voice/speak.py), run with the install's own interpreter, which writes a WAV
// the app reads back and removes. Nothing is installed or downloaded here.

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::ipc::Response;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::DialogExt;

const SCRIPT: &str = include_str!("../../voice/speak.py");
const LIST: &str = "voices.json";
// A first line may wait while a voice loads its model; a stuck one is stopped.
const TIMEOUT: Duration = Duration::from_secs(600);
static LOCK: Mutex<()> = Mutex::new(());
static COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Serialize, Debug, PartialEq)]
pub struct Status {
    pub set: bool,
    pub name: String,
    pub ready: bool,
    pub missing: Vec<String>,
}

fn engine_ok(engine: &str) -> Result<(), String> {
    if matches!(engine, "kokoro" | "chatterbox") { Ok(()) } else { Err("The app has no voice of that kind on this computer.".into()) }
}

/// The interpreter of an install's own environment, where it usually is.
pub fn python_in(folder: &Path) -> Option<PathBuf> {
    [".venv/bin/python", "venv/bin/python", ".venv/Scripts/python.exe", "venv/Scripts/python.exe"].iter().map(|p| folder.join(p)).find(|p| p.is_file())
}

/// What an install folder lacks for its engine, in plain words.
pub fn missing_in(engine: &str, folder: &Path) -> Vec<String> {
    let mut out = Vec::new();
    if python_in(folder).is_none() {
        out.push("a Python environment in .venv or venv".to_string());
    }
    if engine == "kokoro" {
        for f in ["kokoro-v1.0.onnx", "voices-v1.0.bin"] {
            if !folder.join(f).is_file() {
                out.push(f.to_string());
            }
        }
    }
    out
}

fn list_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("The app's folder could not be found: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("The app's folder could not be made: {e}"))?;
    Ok(dir.join(LIST))
}

fn read_list(path: &Path) -> HashMap<String, PathBuf> {
    fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn status_of(engine: &str, folder: Option<&PathBuf>) -> Status {
    match folder {
        None => Status { set: false, name: String::new(), ready: false, missing: Vec::new() },
        Some(f) => {
            let missing = if f.is_dir() { missing_in(engine, f) } else { vec!["the folder itself, which has moved".to_string()] };
            Status { set: true, name: f.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), ready: missing.is_empty(), missing }
        }
    }
}

#[tauri::command]
pub fn voice_status(app: AppHandle, engine: String) -> Result<Status, String> {
    engine_ok(&engine)?;
    Ok(status_of(&engine, read_list(&list_path(&app)?).get(&engine)))
}

/// Asks the system's folder dialog for an install's folder and remembers it.
#[tauri::command]
pub async fn voice_folder(app: AppHandle, engine: String) -> Result<Status, String> {
    engine_ok(&engine)?;
    let picked = app.dialog().file().blocking_pick_folder();
    let path = list_path(&app)?;
    let _g = LOCK.lock().map_err(|_| "Busy.".to_string())?;
    let mut list = read_list(&path);
    if let Some(folder) = picked.and_then(|p| p.into_path().ok()) {
        list.insert(engine.clone(), folder);
        let body = serde_json::to_vec(&list).map_err(|e| e.to_string())?;
        fs::write(&path, body).map_err(|e| format!("The voice could not be remembered: {e}"))?;
    }
    Ok(status_of(&engine, list.get(&engine)))
}

/// A voice name the engines know: letters, digits, underscores and dashes.
pub fn clean_voice(voice: &str) -> String {
    voice.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-')).take(40).collect()
}

/// Runs the script with an install's interpreter and waits for its WAV.
pub fn speak_with(python: &Path, engine: &str, folder: &Path, text: &str, voice: &str, speed: f32, device: &str) -> Result<Vec<u8>, String> {
    let dir = std::env::temp_dir().join("hash-lmg-voice");
    fs::create_dir_all(&dir).map_err(|e| format!("A place for the voice could not be made: {e}"))?;
    let out = dir.join(format!("line-{}-{}.wav", std::process::id(), COUNTER.fetch_add(1, Ordering::Relaxed)));
    let spec = serde_json::json!({ "engine": engine, "folder": folder, "out": out, "text": text, "voice": voice, "speed": speed, "device": device });
    let mut cmd = Command::new(python);
    cmd.arg("-c").arg(SCRIPT).current_dir(folder).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped());
    // A voice that keeps its model files beside it finds them there.
    if folder.join("hf").is_dir() {
        cmd.env("HF_HOME", folder.join("hf"));
    }
    cmd.env("PYTORCH_ENABLE_MPS_FALLBACK", "1");
    let mut child = cmd.spawn().map_err(|e| format!("The voice could not be started: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(spec.to_string().as_bytes()).map_err(|e| format!("The voice could not be given its line: {e}"))?;
    }
    let started = Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
            break s;
        }
        if started.elapsed() > TIMEOUT {
            let _ = child.kill();
            let _ = fs::remove_file(&out);
            return Err("The voice took too long and was stopped.".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let mut err = String::new();
    if let Some(mut e) = child.stderr.take() {
        use std::io::Read;
        let _ = e.read_to_string(&mut err);
    }
    let bytes = fs::read(&out);
    let _ = fs::remove_file(&out);
    if !status.success() {
        let last = err.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").chars().take(300).collect::<String>();
        return Err(format!("The voice stopped with an error. {last}").trim().to_string());
    }
    bytes.map_err(|_| "The voice wrote no sound.".to_string())
}

/// Speaks one line and answers with its WAV.
#[tauri::command]
pub async fn voice_speak(app: AppHandle, engine: String, text: String, voice: String, speed: f32, device: String) -> Result<Response, String> {
    engine_ok(&engine)?;
    let text: String = text.chars().filter(|c| !c.is_control() || *c == '\n').take(1000).collect();
    if text.trim().is_empty() {
        return Err("There is nothing to say.".into());
    }
    let device = if matches!(device.as_str(), "cpu" | "gpu") { device } else { "auto".to_string() };
    let folder = read_list(&list_path(&app)?).get(&engine).cloned().ok_or("Choose where this voice is installed in Settings, under Voice.")?;
    let missing = missing_in(&engine, &folder);
    if !missing.is_empty() {
        return Err(format!("The voice's folder lacks {}.", missing.join(", ")));
    }
    let python = python_in(&folder).ok_or("The voice's folder has no Python environment.")?;
    let voice = clean_voice(&voice);
    let speed = speed.clamp(0.5, 2.0);
    let wav = tauri::async_runtime::spawn_blocking(move || speak_with(&python, &engine, &folder, &text, &voice, speed, &device)).await.map_err(|e| e.to_string())??;
    Ok(Response::new(wav))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("hash-lmg-voice-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn an_install_says_what_it_lacks() {
        let d = scratch("lacks");
        let m = missing_in("kokoro", &d);
        assert!(m.iter().any(|x| x.contains("Python")));
        assert!(m.iter().any(|x| x == "kokoro-v1.0.onnx"));
        assert!(missing_in("chatterbox", &d).len() == 1);
    }

    #[test]
    fn voice_names_keep_only_safe_characters() {
        assert_eq!(clean_voice("af_heart"), "af_heart");
        assert_eq!(clean_voice("../../x; rm"), "xrm");
    }

    #[test]
    fn only_known_engines_are_run() {
        assert!(engine_ok("kokoro").is_ok());
        assert!(engine_ok("sh").is_err());
    }

    // A stand-in interpreter that answers like an install: it reads the
    // request, and writes a short WAV where it is told.
    #[cfg(unix)]
    #[test]
    fn a_line_is_spoken_through_the_install_and_its_sound_read_back() {
        use std::os::unix::fs::PermissionsExt;
        let d = scratch("speak");
        let bin = d.join(".venv/bin");
        fs::create_dir_all(&bin).unwrap();
        let py = bin.join("python");
        fs::write(&py, "#!/bin/sh\nspec=$(cat)\nout=$(printf '%s' \"$spec\" | sed -n 's/.*\"out\":\"\\([^\"]*\\)\".*/\\1/p')\nprintf 'RIFF$\\000\\000\\000WAVEfmt \\020\\000\\000\\000\\001\\000\\001\\000\\200\\273\\000\\000\\000w\\001\\000\\002\\000\\020\\000data\\000\\000\\000\\000' > \"$out\"\n").unwrap();
        fs::set_permissions(&py, fs::Permissions::from_mode(0o755)).unwrap();
        let wav = speak_with(&py, "chatterbox", &d, "A line to say.", "", 1.0, "cpu").expect("spoken");
        assert_eq!(&wav[..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
    }

    #[cfg(unix)]
    #[test]
    fn a_failing_voice_says_why() {
        use std::os::unix::fs::PermissionsExt;
        let d = scratch("fail");
        let py = d.join("python");
        fs::write(&py, "#!/bin/sh\ncat >/dev/null\necho 'No module named kokoro_onnx' >&2\nexit 1\n").unwrap();
        fs::set_permissions(&py, fs::Permissions::from_mode(0o755)).unwrap();
        let err = speak_with(&py, "kokoro", &d, "Hello", "af_heart", 1.0, "auto").unwrap_err();
        assert!(err.contains("No module named kokoro_onnx"), "{err}");
    }
}
