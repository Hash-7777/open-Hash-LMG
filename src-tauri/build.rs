// Reads tauri.conf.json, embeds the icon and the app's metadata, and tells
// Cargo when to run again. Nothing of this app's own happens here.
fn main() {
    tauri_build::build();
}
