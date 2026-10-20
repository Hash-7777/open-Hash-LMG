// Sound through the operating system's own AAC encoder, for web views that
// cannot encode sound themselves. The page sends a WAV and gets back AAC in
// ADTS frames, which it places in the film. Both files live in the app's own
// temporary folder for the moment of the conversion and are removed after.

use tauri::ipc::{InvokeBody, Request, Response};

const MAX_BYTES: usize = 1024 * 1024 * 1024;

pub fn looks_like_wav(b: &[u8]) -> bool {
    b.len() > 44 && &b[0..4] == b"RIFF" && &b[8..12] == b"WAVE"
}

#[tauri::command]
pub async fn aac_encode(request: Request<'_>) -> Result<Response, String> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("No sound was sent.".into()) };
    if bytes.len() > MAX_BYTES || !looks_like_wav(bytes) {
        return Err("The sound was not a WAV the app can encode.".into());
    }
    encode(bytes).map(Response::new)
}

#[cfg(target_os = "macos")]
fn encode(wav: &[u8]) -> Result<Vec<u8>, String> {
    use std::process::Command;
    let stamp = format!("{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    let dir = std::env::temp_dir();
    let input = dir.join(format!("hash-lmg-{stamp}.wav"));
    let output = dir.join(format!("hash-lmg-{stamp}.aac"));
    std::fs::write(&input, wav).map_err(|e| format!("The sound could not be prepared: {e}"))?;
    let run = Command::new("/usr/bin/afconvert").arg("-f").arg("adts").arg("-d").arg("aac").arg("-b").arg("192000").arg(&input).arg(&output).output();
    let result = match run {
        Ok(o) if o.status.success() => std::fs::read(&output).map_err(|e| format!("The encoded sound could not be read: {e}")),
        Ok(o) => Err(format!("The system's sound encoder refused the sound: {}", String::from_utf8_lossy(&o.stderr).trim())),
        Err(e) => Err(format!("The system's sound encoder could not be started: {e}")),
    };
    let _ = std::fs::remove_file(&input);
    let _ = std::fs::remove_file(&output);
    result
}

#[cfg(not(target_os = "macos"))]
fn encode(_wav: &[u8]) -> Result<Vec<u8>, String> {
    Err("This system has no sound encoder the app can use; the film is saved silent with its sound beside it.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_wav_is_taken() {
        let mut wav = b"RIFF\0\0\0\0WAVE".to_vec();
        wav.resize(64, 0);
        assert!(looks_like_wav(&wav));
        assert!(!looks_like_wav(b"RIFF"));
        let mut other = b"RIFF\0\0\0\0AVI ".to_vec();
        other.resize(64, 0);
        assert!(!looks_like_wav(&other));
    }
}
