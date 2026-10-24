fn main() {
    let mut build = cc::Build::new();
    build
        .file("src/host.c")
        .include("include")
        .include("src")
        .warnings(true);
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        build.flag_if_supported("/utf-8");
    }
    build.compile("ofx_host");

    println!("cargo:rerun-if-changed=src/host.c");
    println!("cargo:rerun-if-changed=src/ofx_host.h");
    println!("cargo:rerun-if-changed=include");

    #[cfg(all(unix, not(target_os = "macos")))]
    println!("cargo:rustc-link-lib=dl");
}
