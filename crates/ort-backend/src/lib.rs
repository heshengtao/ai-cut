//! 把 sherpa-onnx 已经静态链接的 ONNX Runtime C API 交给 `ort`。
//!
//! `ort` 开启 `alternative-backend` 后不会自己链接 ONNX Runtime，也不会下载
//! 第二份副本；但调用方必须先通过 `ort::set_api` 把运行时的 `OrtApi` 表交给它。
//! 这里直接调用 C API 的入口 `OrtGetApiBase()`，所以需要一点 unsafe；把 unsafe
//! 关在这个独立 crate 里，主程序仍然可以 `#![forbid(unsafe_code)]`。

#![allow(unsafe_code)]

use std::sync::OnceLock;

/// 与 `ort` 的 `api-17` feature 对应。
const API_VERSION: u32 = 17;

static INIT: OnceLock<bool> = OnceLock::new();

/// 必须在调用任何 `ort` API 之前执行一次。返回是否初始化成功。
pub fn init() -> bool {
    *INIT.get_or_init(|| unsafe {
        let base = ort::sys::OrtGetApiBase();
        if base.is_null() {
            return false;
        }
        let api = ((*base).GetApi)(API_VERSION);
        if api.is_null() {
            return false;
        }
        ort::set_api(std::ptr::read(api))
    })
}
