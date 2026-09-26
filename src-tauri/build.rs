fn main() {
    // 构建时刻注入（用户侧自证 exe 代次：窗口标题/shell.log/设置页状态行均可见）
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    println!("cargo:rustc-env=AV_BUILD_AT={ts}");
    tauri_build::build()
}
