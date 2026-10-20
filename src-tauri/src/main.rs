// Keeps a console window from opening beside the app on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    hash_lmg_lib::run();
}
