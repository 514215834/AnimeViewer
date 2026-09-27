// 发布版隐藏控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
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

// ── v1.0 D2 内置媒体服务 sidecar ──────────────────────────────────────────────
// 壳启动即拉起 resources/service/（jlink 裁剪 JRE + service.jar，scripts/build-service.mjs 拼装），
// 注入：--av.data-dir=%APPDATA%/AnimeViewer/data（数据与 Web 形态工作目录隔离）、
//       --av.parent-pid=<壳pid>（服务端心跳，壳失联后 ~5s 优雅退出并收尾 aria2）、
//       包内 bin/{ffmpeg,ffprobe,aria2c}.exe 存在时注入对应路径（D3 起随包，存在才注入）。
// 退出策略：壳退出**不硬杀**子进程——硬杀会跳过 @PreDestroy 使 aria2c 变孤儿，
//   由服务端 parent-pid 心跳自行优雅退出（watchdog 单元测试 + 实弹验证通过）。

const SERVICE_PORT: u16 = 8787;
const SERVICE_URL: &str = "http://127.0.0.1:8787";

/// 服务端子进程句柄（setup 拉起；service_status 兜底重拉）
struct ServiceProcess {
    child: Mutex<Option<Child>>,
    /// 上次拉起时刻：重拉冷却用——服务端异常退出时（如杀软扫描锁文件首跑竞态）
    /// 防止前端轮询驱动的无脑重拉风暴
    last_spawn: Mutex<Option<std::time::Instant>>,
}

const RESPAWN_COOLDOWN: std::time::Duration = std::time::Duration::from_secs(5);

fn appdata_root() -> Option<std::path::PathBuf> {
    std::env::var_os("APPDATA").map(|d| std::path::PathBuf::from(d).join("AnimeViewer"))
}

/// 去掉 Tauri resource_dir 的 `\\?\` 扩展前缀：CreateProcess 认这种路径，
/// 但 JVM 打不开 `-jar \\?\G:\...` 形式的 jar（Boot loader 类加载失败 → ClassNotFoundException）
fn simplify(p: std::path::PathBuf) -> std::path::PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(stripped) => std::path::PathBuf::from(stripped.to_owned()),
        None => p,
    }
}

/// 简易本地时间戳（诊断日志用，不引 chrono）
fn chrono_like_now() -> String {
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("t+{t}s")
}

/// 构建时刻（build.rs 注入，epoch 秒）：用户侧自证 exe 代次——同一目录可能存在多代拷贝，
/// 桌面化排障第一原则是确认「跑的哪一版」
fn build_at() -> String {
    let ts: u64 = env!("AV_BUILD_AT").parse().unwrap_or(0);
    // 简易 UTC → 本地粗略显示（+8h，仅用于代次识别，不作精确时间）
    let local = ts + 8 * 3600;
    let days = local / 86400;
    let secs = local % 86400;
    let (h, m, s) = (secs / 3600, (secs % 3600) / 60, secs % 60);
    // epoch 1970-01-01 起的民用日期（简化算法足够标识代次）
    let mut y = 1970i64;
    let mut d = days as i64;
    loop {
        let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
        let len = if leap { 366 } else { 365 };
        if d < len { break; }
        d -= len;
        y += 1;
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let ml = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut mo = 0;
    while d >= ml[mo] { d -= ml[mo]; mo += 1; }
    format!("{y}-{:02}-{:02} {:02}:{:02}:{:02}", mo + 1, d + 1, h, m, s)
}

/// 壳侧诊断日志：%APPDATA%/AnimeViewer/logs/shell.log——拉起失败/资源缺失也落盘，
/// 用户环境"内置服务不可达"类问题先看此文件（壳视角命令行）再 service.log（服务端输出）
fn log_shell(msg: &str) {
    let Some(appdata) = appdata_root() else { return };
    let log_dir = appdata.join("logs");
    let _ = std::fs::create_dir_all(&log_dir);
    let line = format!("[{}] {msg}\n", chrono_like_now());
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("shell.log"))
        .and_then(|mut f| std::io::Write::write_all(&mut f, line.as_bytes()));
}

fn spawn_service(app: &tauri::AppHandle) -> Result<Child, String> {
    let service_dir = simplify(
        app.path()
            .resource_dir()
            .map_err(|e| format!("resource_dir: {e}"))?,
    )
    .join("service");
    let java = service_dir.join("runtime").join("bin").join("java.exe");
    let jar = service_dir.join("service.jar");
    if !java.exists() || !jar.exists() {
        // dev 模式（tauri dev）无拼装产物：静默跳过，壳内 Web 功能不受影响。
        // 日志先行（payload 缺失也是诊断信息），再返回——保证 shell.log 一定有壳侧轨迹
        let _ = log_shell(&format!(
            "spawn: service payload 缺失（java={} exists={} / jar={} exists={}），跳过拉起",
            java.to_string_lossy(),
            java.exists(),
            jar.to_string_lossy(),
            jar.exists(),
        ));
        return Err("service payload not bundled (dev 模式无 resources/service，跳过拉起)".into());
    }
    let appdata = appdata_root().ok_or("APPDATA 环境变量不存在")?;
    let data_dir = appdata.join("data");
    let log_dir = appdata.join("logs");
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("service.log"))
        .map_err(|e| format!("打开服务日志失败: {e}"))?;
    let log_err = log.try_clone().map_err(|e| e.to_string())?;

    let mut args: Vec<String> = vec![
        "-jar".into(),
        jar.to_string_lossy().into_owned(),
        "--server.address=127.0.0.1".into(),
        format!("--server.port={SERVICE_PORT}"),
        format!("--av.data-dir={}", data_dir.to_string_lossy()),
        format!("--av.parent-pid={}", std::process::id()),
    ];
    let bin_dir = service_dir.join("bin");
    let ffmpeg = bin_dir.join("ffmpeg.exe");
    let ffprobe = bin_dir.join("ffprobe.exe");
    let aria2 = bin_dir.join("aria2c.exe");
    if ffmpeg.exists() {
        args.push(format!("--av.ffmpeg-path={}", ffmpeg.to_string_lossy()));
        if ffprobe.exists() {
            args.push(format!("--av.ffprobe-path={}", ffprobe.to_string_lossy()));
        }
    }
    if aria2.exists() {
        args.push(format!("--av.aria2.path={}", aria2.to_string_lossy()));
    }

    // 壳侧诊断：记录实际使用的资源目录与完整命令行（排查资源定位/参数问题）
    log_shell(&format!(
        "spawn: resource_dir={}\n  java={}\n  args={:?}",
        app.path().resource_dir().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default(),
        java.to_string_lossy(),
        args,
    ));

    let mut cmd = Command::new(java);
    cmd.args(args)
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));
    // CREATE_NO_WINDOW：壳是 GUI 程序（windows_subsystem="windows"），派生控制台程序 java.exe 时
    // Windows 会为其新建控制台窗口（用户看到的"cmd 窗口"），此标志抑制之；
    // stdout/stderr 已重定向 service.log，窗口里本无内容；java 之下的 aria2c/ffmpeg 等孙进程
    // 继承该不可见控制台，同样不再弹窗。dev 模式壳本身有控制台，继承场景下此标志无副作用。
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.spawn()
        .map_err(|e| {
            log_shell(&format!("spawn 失败: {e}"));
            format!("拉起服务端失败: {e}")
        })
}

#[derive(serde::Serialize)]
struct ServiceStatus {
    running: bool,
    /// 端口可达（壳侧 TCP 探测，绕开 WebView2 网络栈——系统代理/CORS 等因素不参与判定）
    ready: bool,
    url: String,
    token: Option<String>,
    error: Option<String>,
    /// 壳构建时刻（用户侧自证 exe 代次）
    build_at: String,
}

/// 壳侧健康判定：TCP 连 127.0.0.1:8787 成功即视为 Tomcat 已就绪。
/// 不在 WebView2 里 fetch /api/health——桌面端 fetch 受系统代理等环境因素干扰，
/// 桥接是壳的职责，应在壳进程内闭环判定。
fn port_ready() -> bool {
    use std::net::{SocketAddr, TcpStream};
    let addr: SocketAddr = format!("127.0.0.1:{SERVICE_PORT}").parse().expect("static addr");
    TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(800)).is_ok()
}

/// 前端自动桥接入口：确保子进程在位（死亡兜底重拉一次）并回读 data/token；
/// HTTP 就绪由前端自行轮询 /api/health 判定（本命令不做网络请求）
#[tauri::command]
fn service_status(app: tauri::AppHandle, state: tauri::State<ServiceProcess>) -> ServiceStatus {
    let mut guard = state.child.lock().expect("service state poisoned");
    let mut alive = match guard.as_mut() {
        Some(c) => matches!(c.try_wait(), Ok(None)),
        _ => false,
    };
    let mut error: Option<String> = None;
    if !alive {
        let mut last = state.last_spawn.lock().expect("spawn state poisoned");
        if last.map_or(true, |t| t.elapsed() >= RESPAWN_COOLDOWN) {
            match spawn_service(&app) {
                Ok(c) => {
                    *guard = Some(c);
                    alive = true;
                }
                Err(e) => error = Some(e),
            }
            *last = Some(std::time::Instant::now());
        }
    }
    let token = appdata_root()
        .and_then(|d| std::fs::read_to_string(d.join("data").join("token")).ok())
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());
    ServiceStatus {
        running: alive,
        ready: port_ready(),
        url: SERVICE_URL.into(),
        token,
        error,
        build_at: build_at(),
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
        .manage(ServiceProcess {
            child: Mutex::new(None),
            last_spawn: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![service_status])
        .setup(|app| {
            // 版本自证：窗口标题带构建时刻 + shell.log 首行记录（用户侧多代 exe 混存的排障锚点）
            let build_tag = format!("AnimeViewer · 动漫追番面板 (build {})", build_at());
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_title(&build_tag);
            }
            log_shell(&format!(
                "shell 启动：build={} pid={}",
                build_at(),
                std::process::id()
            ));
            // 启动即拉起内置服务；失败不阻断（如 dev 模式无产物），service_status 兜底重拉
            let state: tauri::State<ServiceProcess> = app.state();
            match spawn_service(app.handle()) {
                Ok(child) => {
                    *state.child.lock().expect("service state poisoned") = Some(child);
                    *state.last_spawn.lock().expect("spawn state poisoned") = Some(std::time::Instant::now());
                }
                Err(e) => eprintln!("[AnimeViewer] 内置服务未拉起: {e}"),
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // 退出不做硬杀：服务端 parent-pid 心跳在壳退出后 ~5s 自行优雅退出
        });
}
