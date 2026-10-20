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
        .invoke_handler(tauri::generate_handler![
            commands::projects::project_list,
            commands::projects::project_read,
            commands::projects::project_write,
            commands::projects::project_delete,
            commands::export::export_begin,
            commands::export::export_chunk,
            commands::export::export_end,
            commands::sound::aac_encode,
        ])
        .run(tauri::generate_context!())
        .expect("Hash LMG could not start");
}
