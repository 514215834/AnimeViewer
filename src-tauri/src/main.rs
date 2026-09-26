// 发布版隐藏控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

/// Windows 系统代理 → 环境变量桥接：plugin-http 的 reqwest 仅读 HTTP(S)_PROXY 环境变量，
/// 不读系统代理设置；桌面端双击启动没有 shell env，这里显式桥接，
/// 保证在线模式行为与 Web 版一致（浏览器 fetch 默认走系统代理）。显式设置的环境变量优先。
#[cfg(windows)]
fn apply_system_proxy() {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(settings) = hkcu.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings") else {
        return;
    };
    let enabled: u32 = settings.get_value("ProxyEnable").unwrap_or(0);
    if enabled != 1 {
        return;
    }
    let server: String = settings.get_value("ProxyServer").unwrap_or_default();
    if server.is_empty() {
        return;
    }
    // ProxyServer 形如 "127.0.0.1:7897"，带协议区分时形如 "http=...;https=..."（优先取 https 段）
    let proxy = if server.contains('=') {
        server
            .split(';')
            .filter_map(|p| {
                let p = p.trim();
                p.strip_prefix("https=").or_else(|| p.strip_prefix("http="))
            })
            .next()
            .map(|s| s.to_string())
            .unwrap_or(server)
    } else {
        server
    };
    if proxy.is_empty() {
        return;
    }
    if std::env::var_os("HTTPS_PROXY").is_none() {
        std::env::set_var("HTTPS_PROXY", format!("http://{proxy}"));
    }
    if std::env::var_os("HTTP_PROXY").is_none() {
        std::env::set_var("HTTP_PROXY", format!("http://{proxy}"));
    }
}

fn main() {
    #[cfg(windows)]
    apply_system_proxy();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 二次启动：唤起既有主窗口（还原/聚焦），保证单实例语义
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        // 窗口状态记忆：关闭时的尺寸/位置自动持久化，下次启动还原
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
