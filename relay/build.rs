use std::process::Command;

fn main() {
    let out = Command::new("rustc")
        .arg("--version")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|_| "rustc unknown".to_string());
    println!("cargo:rustc-env=RUSTC_VERSION={out}");
    println!("cargo:rerun-if-changed=build.rs");
}
