// What each request to a model used, appended as one line to usage.jsonl in
// the app's own data folder, for token counters on this computer to read.
//
// Counts only: when, which service and model, and how many tokens were read,
// written and read from the service's cache. Never a brief, a prompt or an
// answer. One JSON object a line:
//   {"ts", "model", "input_tokens", "output_tokens", "cache_read", "cache_write", "cost"}
// The field names are the shared format such counters read; cost is 0, since
// the app does not know any service's prices.

use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use tauri::{AppHandle, Manager};

const FILE: &str = "usage.jsonl";
const MAX_MODEL_CHARS: usize = 256;
const MAX_TS_CHARS: usize = 64;
/// Past this the file starts again, keeping it small; counters read the recent days.
const MAX_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Serialize, Deserialize, Debug, PartialEq)]
pub struct UsageRecord {
    pub ts: String,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    #[serde(default)]
    pub cache_read: u64,
    #[serde(default)]
    pub cache_write: u64,
    #[serde(default)]
    pub cost: f64,
}

/// A record past these limits is refused rather than cut: a shortened model
/// name would be counted as another model.
pub fn check(record: &UsageRecord) -> Result<(), String> {
    if record.model.is_empty() || record.model.chars().count() > MAX_MODEL_CHARS || record.model.chars().any(|c| c.is_control()) {
        return Err("usage record refused: the model name is empty, too long or not plain text".into());
    }
    if record.ts.chars().count() > MAX_TS_CHARS || record.ts.chars().any(|c| c.is_control()) {
        return Err("usage record refused: the time is too long or not plain text".into());
    }
    if !record.cost.is_finite() || record.cost < 0.0 {
        return Err("usage record refused: the cost is not a number".into());
    }
    Ok(())
}

#[tauri::command]
pub fn usage_log_append(app: AppHandle, record: UsageRecord) -> Result<(), String> {
    check(&record)?;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(FILE);
    if std::fs::metadata(&path).map(|m| m.len() > MAX_BYTES).unwrap_or(false) {
        let _ = std::fs::rename(&path, dir.join("usage.old.jsonl"));
    }
    let mut file = OpenOptions::new().create(true).append(true).open(&path).map_err(|e| e.to_string())?;
    let line = serde_json::to_string(&record).map_err(|e| e.to_string())? + "\n";
    file.write_all(line.as_bytes()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(model: &str) -> UsageRecord {
        UsageRecord { ts: "2026-10-25T10:00:00.000Z".into(), model: model.into(), input_tokens: 1200, output_tokens: 340, cache_read: 800, cache_write: 0, cost: 0.0 }
    }

    #[test]
    fn a_line_carries_counts_and_nothing_else() {
        let line = serde_json::to_string(&record("ollama:qwen2.5:7b")).unwrap();
        assert_eq!(line, r#"{"ts":"2026-10-25T10:00:00.000Z","model":"ollama:qwen2.5:7b","input_tokens":1200,"output_tokens":340,"cache_read":800,"cache_write":0,"cost":0.0}"#);
    }

    #[test]
    fn optional_counts_default_to_zero() {
        let r: UsageRecord = serde_json::from_str(r#"{"ts":"t","model":"m","input_tokens":1,"output_tokens":2}"#).unwrap();
        assert_eq!((r.cache_read, r.cache_write, r.cost), (0, 0, 0.0));
    }

    #[test]
    fn odd_records_are_refused() {
        assert!(check(&record("deepseek:a-model")).is_ok());
        assert!(check(&record("")).is_err());
        assert!(check(&record(&"m".repeat(MAX_MODEL_CHARS + 1))).is_err());
        assert!(check(&record("line\nbreak")).is_err());
        let mut r = record("m");
        r.cost = f64::NAN;
        assert!(check(&r).is_err());
    }
}
