use std::fs;
use rfd::FileDialog;

#[derive(serde::Serialize)]
struct OpenResult {
    path: Option<String>,
    content: String,
}

#[tauri::command]
fn open_file() -> Result<OpenResult, String> {
    let file = FileDialog::new()
        .add_filter("Markdown", &["md", "markdown"])
        .add_filter("Text", &["txt"])
        .pick_file();

    if let Some(path) = file {
        match fs::read_to_string(&path) {
            Ok(content) => Ok(OpenResult {
                path: Some(path.to_string_lossy().to_string()),
                content,
            }),
            Err(e) => Err(format!("Failed to read file: {}", e)),
        }
    } else {
        Ok(OpenResult { path: None, content: String::new() }) // User canceled
    }
}

#[tauri::command]
fn save_file(content: String, path: Option<String>) -> Result<String, String> {
    let save_path = if let Some(p) = path {
        std::path::PathBuf::from(p)
    } else {
        match FileDialog::new()
            .add_filter("Markdown", &["md", "markdown"])
            .save_file() {
            Some(p) => p,
            None => return Ok(String::new()), // User canceled
        }
    };

    match fs::write(&save_path, content) {
        Ok(_) => Ok(save_path.to_string_lossy().to_string()),
        Err(e) => Err(format!("Failed to write file: {}", e)),
    }
}

#[tauri::command]
fn drag_window(window: tauri::Window) {
    let _ = window.start_dragging();
}

#[tauri::command]
fn save_image(app: tauri::AppHandle, base64_data: String) -> Result<String, String> {
    use tauri::Manager;
    let parts: Vec<&str> = base64_data.split(',').collect();
    if parts.len() < 2 { return Err("Invalid format".into()); }
    
    use base64::{Engine as _, engine::general_purpose};
    let data = general_purpose::STANDARD.decode(parts[1]).map_err(|e| e.to_string())?;

    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let img_dir = app_dir.join("images");
    fs::create_dir_all(&img_dir).map_err(|e| e.to_string())?;
    
    let filename = format!("img_{}.png", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
    let path = img_dir.join(filename);
    fs::write(&path, data).map_err(|e| e.to_string())?;
    
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn read_image(path: String) -> Result<String, String> {
    let data = fs::read(path).map_err(|e| e.to_string())?;
    use base64::{Engine as _, engine::general_purpose};
    let base64 = general_purpose::STANDARD.encode(data);
    Ok(format!("data:image/png;base64,{}", base64))
}

#[tauri::command]
fn toggle_always_on_top(window: tauri::Window, always_on_top: bool) {
    let _ = window.set_always_on_top(always_on_top);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![open_file, save_file, drag_window, toggle_always_on_top, save_image, read_image])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
