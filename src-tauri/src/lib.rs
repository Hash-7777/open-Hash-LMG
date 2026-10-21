// The desktop side of Hash LMG.
//
// The page does almost everything: the editor, the models, the drawing and
// the encoding. This side does only what a web page cannot: keep films in the
// app's own folder, write an export where the person chose in the system's
// save dialog, and encode sound with the operating system's encoder. Each is
// a command written for that one job, and none of them takes a file path from
// the page.

mod commands;
mod security;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(security::navigation::guard())
        .manage(commands::export::Exports::default())
        .manage(commands::encode::Encoders::default())
        .invoke_handler(tauri::generate_handler![
            commands::projects::project_list,
            commands::projects::project_read,
            commands::projects::project_write,
            commands::projects::project_delete,
            commands::export::export_begin,
            commands::export::export_chunk,
            commands::export::export_end,
            commands::sound::aac_encode,
            commands::encode::encoder_open,
            commands::encode::encoder_frame,
            commands::encode::encoder_close,
            commands::encode::mp3_encode,
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            self_test(app);
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Hash LMG could not start");
}

// A debug build started with LMG_SELFTEST naming a script runs that script in
// the window once the page has loaded, so the real app can be exercised end to
// end without anyone at the keyboard. Release builds do not contain this.
#[cfg(debug_assertions)]
fn self_test(app: &tauri::App) {
    use tauri::Manager;
    let Ok(path) = std::env::var("LMG_SELFTEST") else {
        return;
    };
    let Ok(script) = std::fs::read_to_string(&path) else {
        return;
    };
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(3));
        let _ = window.eval(&script);
    });
}
