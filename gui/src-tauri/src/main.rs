// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Child;
#[cfg(not(debug_assertions))]
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;

struct BackendProcess(Mutex<Option<Child>>);

#[cfg(not(debug_assertions))]
fn spawn_backend(backend: &std::path::Path) -> std::io::Result<Child> {
    if let Ok(node) = std::env::var("AGENTS_KIT_NODE") {
        return Command::new(node)
            .arg(backend)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }

    let mut node_candidates = vec![
        std::path::PathBuf::from("/opt/homebrew/bin/node"),
        std::path::PathBuf::from("/usr/local/bin/node"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        let home = std::path::PathBuf::from(home);
        node_candidates.extend([
            home.join(".local/share/mise/installs/node/latest/bin/node"),
            home.join(".volta/bin/node"),
            home.join(".nvm/current/bin/node"),
        ]);
    }

    for node in node_candidates {
        if node.is_file() {
            return Command::new(&node)
                .arg(backend)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();
        }
    }

    #[cfg(target_os = "macos")]
    {
        return Command::new("/bin/zsh")
            .args(["-lc", "exec node \"$AGENTS_KIT_BACKEND\""])
            .env("AGENTS_KIT_BACKEND", backend)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }

    #[cfg(not(target_os = "macos"))]
    Command::new("node")
        .arg(backend)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
}

fn main() {
    tauri::Builder::default()
        .setup(|_app| {
            #[cfg(not(debug_assertions))]
            {
                let backend = _app
                    .path()
                    .resource_dir()?
                    .join("resources")
                    .join("backend.mjs");
                let child = match spawn_backend(&backend) {
                    Ok(child) => Some(child),
                    Err(error) => {
                        eprintln!(
                            "failed to start agents-kit backend; install Node.js 20+: {error}"
                        );
                        None
                    }
                };
                _app.manage(BackendProcess(Mutex::new(child)));
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<BackendProcess>() {
                    if let Ok(mut process) = state.0.lock() {
                        if let Some(child) = process.as_mut() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                }
            }
        });
}
