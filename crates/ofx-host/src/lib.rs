//! Safe wrapper around the C OFX host.
//!
//! The C side owns the OFX ABI and pixel buffers; this module converts probe
//! results to plain Rust/Serde types and keeps all calls serialized.  OFX
//! plugins are not thread-safe and the C host keeps a few globals, so a
//! process-wide spin lock is used.  A `Session` holds the lock for its whole
//! lifetime, which also prevents two bundles from fighting over global state.

use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub mod ppm;

#[repr(C)]
struct RawParamInfo {
    name: *mut c_char,
    label: *mut c_char,
    kind: *mut c_char,
    hint: *mut c_char,
    parent: *mut c_char,
    secret: c_int,
    enabled: c_int,
    dimension: c_int,
    defaults: [f64; 4],
    int_defaults: [c_int; 4],
    string_default: *mut c_char,
    has_min: c_int,
    has_max: c_int,
    has_display_min: c_int,
    has_display_max: c_int,
    has_increment: c_int,
    min: [f64; 4],
    max: [f64; 4],
    display_min: [f64; 4],
    display_max: [f64; 4],
    increment: [f64; 4],
    digits: c_int,
    choice_count: c_int,
    choices: *mut *mut c_char,
}

#[repr(C)]
struct RawPluginInfo {
    identifier: *mut c_char,
    name: *mut c_char,
    label: *mut c_char,
    grouping: *mut c_char,
    version: *mut c_char,
    plugin_api: *mut c_char,
    api_version: c_int,
    version_major: u32,
    version_minor: u32,
    context: *mut c_char,
    contexts: *mut *mut c_char,
    context_count: c_int,
    pixel_depths: *mut *mut c_char,
    pixel_depth_count: c_int,
    clips: *mut *mut c_char,
    clip_count: c_int,
    params: *mut RawParamInfo,
    param_count: c_int,
}

#[repr(C)]
struct RawProbeResult {
    plugins: *mut RawPluginInfo,
    count: c_int,
    error: *mut c_char,
}

#[repr(C)]
struct RawParamValue {
    name: *const c_char,
    d: [f64; 4],
    i: c_int,
    s: *const c_char,
}

#[repr(C)]
struct RawInput {
    clip: *const c_char,
    rgba: *const f32,
}

#[repr(C)]
pub struct OfxHostSession {
    _private: [u8; 0],
}

extern "C" {
    fn ofx_host_probe(
        bundle: *const c_char,
        plugin_id: *const c_char,
        context: *const c_char,
    ) -> *mut RawProbeResult;
    fn ofx_host_probe_free(result: *mut RawProbeResult);

    fn ofx_host_session_open(
        bundle: *const c_char,
        plugin: *const c_char,
        context: *const c_char,
        width: c_int,
        height: c_int,
        error: *mut *mut c_char,
    ) -> *mut OfxHostSession;

    fn ofx_host_session_render_multi(
        session: *mut OfxHostSession,
        time: f64,
        inputs: *const RawInput,
        input_count: c_int,
        transition: f64,
        params: *const RawParamValue,
        param_count: c_int,
        output: *mut *mut f32,
        error: *mut *mut c_char,
    ) -> c_int;

    fn ofx_host_session_source_time(
        session: *mut OfxHostSession,
        time: f64,
        params: *const RawParamValue,
        param_count: c_int,
        source_time: *mut f64,
        error: *mut *mut c_char,
    ) -> c_int;

    fn ofx_host_session_set_duration(session: *mut OfxHostSession, duration: f64);

    fn ofx_host_session_set_frame_rate(session: *mut OfxHostSession, fps: f64);

    fn ofx_host_session_set_source_time(session: *mut OfxHostSession, source_time: f64);

    fn ofx_host_session_close(session: *mut OfxHostSession);

    fn ofx_host_free(pointer: *mut c_void);
    fn ofx_host_version() -> *const c_char;
}

/// A parameter reported by an OFX plugin.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParamInfo {
    pub name: String,
    pub label: String,
    #[serde(rename = "type")]
    pub param_type: String,
    pub hint: String,
    pub parent: String,
    pub secret: bool,
    pub enabled: bool,
    pub dimension: u32,
    /// Number, boolean, string or an array of numbers depending on `type`.
    #[serde(rename = "default")]
    pub default_value: Value,
    pub min: Option<Vec<f64>>,
    pub max: Option<Vec<f64>>,
    pub display_min: Option<Vec<f64>>,
    pub display_max: Option<Vec<f64>>,
    pub increment: Option<Vec<f64>>,
    pub digits: i32,
    pub choices: Vec<String>,
}

/// One plugin in a bundle.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub identifier: String,
    pub name: String,
    pub label: String,
    pub grouping: String,
    pub version: String,
    pub plugin_api: String,
    pub api_version: i32,
    pub version_major: u32,
    pub version_minor: u32,
    /// The context whose parameter table was described.
    pub context: String,
    pub contexts: Vec<String>,
    pub pixel_depths: Vec<String>,
    pub clips: Vec<String>,
    pub params: Vec<ParamInfo>,
}

impl PluginInfo {
    /// Parameter names that actually carry a value (groups/pages do not).
    pub fn value_params(&self) -> impl Iterator<Item = &ParamInfo> {
        self.params
            .iter()
            .filter(|param| !matches!(param.param_type.as_str(), "group" | "page" | "pushbutton"))
    }

    /// Default values keyed by script name; useful when adding an effect.
    pub fn default_params(&self) -> Map<String, Value> {
        let mut map = Map::new();
        for param in self.value_params() {
            if !param.default_value.is_null() {
                map.insert(param.name.clone(), param.default_value.clone());
            }
        }
        map
    }
}

/// A value passed to a render.  The C host picks the field that matches the
/// parameter type, so callers may fill in more than one representation.
#[derive(Debug, Clone, Default)]
pub struct ParamValue {
    pub name: String,
    pub doubles: [f64; 4],
    pub int: i32,
    pub string: Option<String>,
}

impl ParamValue {
    pub fn number(name: impl Into<String>, value: f64) -> Self {
        Self {
            name: name.into(),
            doubles: [value, 0.0, 0.0, 0.0],
            int: value as i32,
            string: None,
        }
    }

    pub fn integer(name: impl Into<String>, value: i32) -> Self {
        Self {
            name: name.into(),
            doubles: [value as f64, 0.0, 0.0, 0.0],
            int: value,
            string: None,
        }
    }

    pub fn boolean(name: impl Into<String>, value: bool) -> Self {
        Self::integer(name, i32::from(value))
    }

    pub fn text(name: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            doubles: [0.0; 4],
            int: 0,
            string: Some(value.into()),
        }
    }

    pub fn color(name: impl Into<String>, values: &[f64]) -> Self {
        let mut doubles = [0.0; 4];
        for (index, value) in values.iter().take(4).enumerate() {
            doubles[index] = *value;
        }
        Self {
            name: name.into(),
            doubles,
            int: 0,
            string: None,
        }
    }

    pub fn from_json(name: impl Into<String>, value: &Value) -> Option<Self> {
        let name = name.into();
        match value {
            Value::Number(number) => Some(Self::number(name, number.as_f64()?)),
            Value::Bool(flag) => Some(Self::boolean(name, *flag)),
            Value::String(text) => Some(Self::text(name, text.clone())),
            Value::Array(items) => {
                let values: Vec<f64> = items.iter().filter_map(Value::as_f64).collect();
                if values.is_empty() {
                    None
                } else {
                    Some(Self::color(name, &values))
                }
            }
            Value::Null => None,
            _ => None,
        }
    }
}

/// Convert a JSON parameter object to render values.
pub fn params_from_json(map: &Map<String, Value>) -> Vec<ParamValue> {
    map.iter()
        .filter_map(|(name, value)| ParamValue::from_json(name.clone(), value))
        .collect()
}

/// Probe every plugin in a bundle.  `plugin` and `context` are optional.
pub fn probe(
    bundle: &str,
    plugin: Option<&str>,
    context: Option<&str>,
) -> Result<Vec<PluginInfo>, String> {
    let _guard = HostGuard::acquire();
    let bundle = cstring(bundle, "bundle")?;
    let plugin = optional_cstring(plugin)?;
    let context = optional_cstring(context)?;

    let result = unsafe {
        ofx_host_probe(
            bundle.as_ptr(),
            plugin.as_ref().map_or(ptr::null(), |value| value.as_ptr()),
            context.as_ref().map_or(ptr::null(), |value| value.as_ptr()),
        )
    };
    if result.is_null() {
        return Err("OFX 探测失败：内存不足".to_string());
    }

    let mut error = None;
    let mut plugins = Vec::new();
    unsafe {
        let raw = &*result;
        if !raw.error.is_null() {
            error = Some(take_string(raw.error));
        }
        if !raw.plugins.is_null() && raw.count > 0 {
            let items = std::slice::from_raw_parts(raw.plugins, raw.count as usize);
            for item in items {
                plugins.push(convert_plugin(item));
            }
        }
        ofx_host_probe_free(result);
    }

    if let Some(error) = error {
        return Err(error);
    }
    Ok(plugins)
}

/// A reusable plugin instance.  OFX calls are serialized per call, so
/// multiple sessions can be open (for an effect chain) without deadlocking.
pub struct Session {
    raw: *mut OfxHostSession,
    width: u32,
    height: u32,
}

// The session is used from one thread at a time; the host lock already
// serializes all OFX calls.
unsafe impl Send for Session {}

impl Session {
    pub fn open(
        bundle: &str,
        plugin: &str,
        context: Option<&str>,
        width: u32,
        height: u32,
    ) -> Result<Self, String> {
        if width == 0 || height == 0 {
            return Err("渲染尺寸必须大于 0".to_string());
        }
        let _guard = HostGuard::acquire();
        let bundle = cstring(bundle, "bundle")?;
        let plugin = cstring(plugin, "plugin")?;
        let context = optional_cstring(context)?;
        let mut error: *mut c_char = ptr::null_mut();
        let raw = unsafe {
            ofx_host_session_open(
                bundle.as_ptr(),
                plugin.as_ptr(),
                context.as_ref().map_or(ptr::null(), |value| value.as_ptr()),
                width as c_int,
                height as c_int,
                &mut error,
            )
        };
        if raw.is_null() {
            let message = unsafe { take_error(error) };
            return Err(message.unwrap_or_else(|| "无法打开 OFX 会话".to_string()));
        }
        Ok(Self { raw, width, height })
    }

    pub fn size(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    /// Render a single `Source` input (filter / generator / paint / retimer).
    /// `input` must be `width * height * 4` RGBA floats.
    pub fn render(
        &mut self,
        time: f64,
        input: &[f32],
        params: &[ParamValue],
    ) -> Result<Vec<f32>, String> {
        self.render_multi(time, &[("Source", input)], None, params)
    }

    /// Render one or more named input clips.  Transition plugins want
    /// `SourceFrom` + `SourceTo`; General-context plugins may name their own.
    pub fn render_multi(
        &mut self,
        time: f64,
        inputs: &[(&str, &[f32])],
        transition: Option<f64>,
        params: &[ParamValue],
    ) -> Result<Vec<f32>, String> {
        let _guard = HostGuard::acquire();
        let expected = (self.width as usize) * (self.height as usize) * 4;
        if inputs.is_empty() {
            return Err("OFX 渲染至少需要一个输入".to_string());
        }
        for (name, pixels) in inputs {
            if pixels.len() != expected {
                return Err(format!(
                    "输入 {name} 的像素数量不匹配：期望 {expected}，实际 {}",
                    pixels.len()
                ));
            }
        }

        let names: Vec<CString> = params
            .iter()
            .map(|param| cstring(&param.name, "param name"))
            .collect::<Result<_, _>>()?;
        let strings: Vec<Option<CString>> = params
            .iter()
            .map(|param| match &param.string {
                Some(value) => Ok(Some(cstring(value, "param value")?)),
                None => Ok(None),
            })
            .collect::<Result<Vec<_>, String>>()?;
        let raw_params: Vec<RawParamValue> = params
            .iter()
            .enumerate()
            .map(|(index, param)| RawParamValue {
                name: names[index].as_ptr(),
                d: param.doubles,
                i: param.int,
                s: strings[index]
                    .as_ref()
                    .map_or(ptr::null(), |value| value.as_ptr()),
            })
            .collect();

        let clip_names: Vec<CString> = inputs
            .iter()
            .map(|(name, _)| cstring(name, "clip name"))
            .collect::<Result<_, _>>()?;
        let raw_inputs: Vec<RawInput> = inputs
            .iter()
            .enumerate()
            .map(|(index, (_, pixels))| RawInput {
                clip: clip_names[index].as_ptr(),
                rgba: pixels.as_ptr(),
            })
            .collect();

        let mut output: *mut f32 = ptr::null_mut();
        let mut error: *mut c_char = ptr::null_mut();
        let status = unsafe {
            ofx_host_session_render_multi(
                self.raw,
                time,
                raw_inputs.as_ptr(),
                raw_inputs.len() as c_int,
                transition.unwrap_or(-1.0),
                raw_params.as_ptr(),
                raw_params.len() as c_int,
                &mut output,
                &mut error,
            )
        };
        if status != 0 {
            let message = unsafe { take_error(error) };
            return Err(message.unwrap_or_else(|| format!("OFX 渲染失败（{status}）")));
        }
        if output.is_null() {
            return Err("OFX 插件没有返回图像".to_string());
        }
        let pixels = unsafe { std::slice::from_raw_parts(output, expected).to_vec() };
        unsafe { ofx_host_free(output as *mut c_void) };
        Ok(pixels)
    }

    /// Ask a Retimer plugin which source time it wants for `time`.
    pub fn source_time(&mut self, time: f64, params: &[ParamValue]) -> Result<f64, String> {
        let _guard = HostGuard::acquire();
        let names: Vec<CString> = params
            .iter()
            .map(|param| cstring(&param.name, "param name"))
            .collect::<Result<_, _>>()?;
        let strings: Vec<Option<CString>> = params
            .iter()
            .map(|param| match &param.string {
                Some(value) => Ok(Some(cstring(value, "param value")?)),
                None => Ok(None),
            })
            .collect::<Result<Vec<_>, String>>()?;
        let raw_params: Vec<RawParamValue> = params
            .iter()
            .enumerate()
            .map(|(index, param)| RawParamValue {
                name: names[index].as_ptr(),
                d: param.doubles,
                i: param.int,
                s: strings[index]
                    .as_ref()
                    .map_or(ptr::null(), |value| value.as_ptr()),
            })
            .collect();
        let mut result = time;
        let mut error: *mut c_char = ptr::null_mut();
        let status = unsafe {
            ofx_host_session_source_time(
                self.raw,
                time,
                raw_params.as_ptr(),
                raw_params.len() as c_int,
                &mut result,
                &mut error,
            )
        };
        if status != 0 {
            let message = unsafe { take_error(error) };
            return Err(message.unwrap_or_else(|| format!("OFX SourceTime 查询失败（{status}）")));
        }
        Ok(result)
    }

    /// Inform transition / retimer plugins how long the clip is, in seconds.
    pub fn set_duration(&mut self, duration: f64) {
        let _guard = HostGuard::acquire();
        unsafe { ofx_host_session_set_duration(self.raw, duration) };
    }

    /// Inform time-aware plugins of the project frame rate.
    pub fn set_frame_rate(&mut self, fps: f64) {
        if !(fps > 0.0) {
            return;
        }
        let _guard = HostGuard::acquire();
        unsafe { ofx_host_session_set_frame_rate(self.raw, fps) };
    }

    /// Set the Retimer SourceTime that the plugin should render this frame with.
    pub fn set_source_time(&mut self, source_time: f64) {
        let _guard = HostGuard::acquire();
        unsafe { ofx_host_session_set_source_time(self.raw, source_time) };
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        if !self.raw.is_null() {
            let _guard = HostGuard::acquire();
            unsafe { ofx_host_session_close(self.raw) };
            self.raw = ptr::null_mut();
        }
    }
}

/// One-shot render helper.
pub fn render_frame(
    bundle: &str,
    plugin: &str,
    context: Option<&str>,
    width: u32,
    height: u32,
    time: f64,
    input: &[f32],
    params: &[ParamValue],
) -> Result<Vec<f32>, String> {
    let mut session = Session::open(bundle, plugin, context, width, height)?;
    session.render(time, input, params)
}

pub fn version() -> &'static str {
    unsafe {
        let raw = ofx_host_version();
        if raw.is_null() {
            "unknown"
        } else {
            // The pointer is a static string literal in C.
            match CStr::from_ptr(raw).to_str() {
                Ok(value) => value,
                Err(_) => "unknown",
            }
        }
    }
}

/* ------------------------------------------------------------------------- */
/* Conversion helpers                                                        */
/* ------------------------------------------------------------------------- */

struct HostGuard;

static HOST_BUSY: AtomicBool = AtomicBool::new(false);

impl HostGuard {
    fn acquire() -> Self {
        while HOST_BUSY
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .is_err()
        {
            std::thread::sleep(Duration::from_millis(1));
        }
        HostGuard
    }
}

impl Drop for HostGuard {
    fn drop(&mut self) {
        HOST_BUSY.store(false, Ordering::Release);
    }
}

fn cstring(value: &str, label: &str) -> Result<CString, String> {
    CString::new(value).map_err(|_| format!("{label} 包含 NUL 字符"))
}

fn optional_cstring(value: Option<&str>) -> Result<Option<CString>, String> {
    match value {
        Some(value) if !value.is_empty() => Ok(Some(cstring(value, "argument")?)),
        _ => Ok(None),
    }
}

unsafe fn take_string(pointer: *mut c_char) -> String {
    if pointer.is_null() {
        String::new()
    } else {
        CStr::from_ptr(pointer).to_string_lossy().into_owned()
    }
}

unsafe fn take_error(pointer: *mut c_char) -> Option<String> {
    if pointer.is_null() {
        return None;
    }
    let message = CStr::from_ptr(pointer).to_string_lossy().into_owned();
    ofx_host_free(pointer as *mut c_void);
    Some(message)
}

unsafe fn take_string_list(pointer: *mut *mut c_char, count: c_int) -> Vec<String> {
    if pointer.is_null() || count <= 0 {
        return Vec::new();
    }
    let items = std::slice::from_raw_parts(pointer, count as usize);
    items
        .iter()
        .map(|item| take_string(*item))
        .collect::<Vec<_>>()
}

fn optional_values(flag: c_int, values: &[f64; 4], dimension: u32) -> Option<Vec<f64>> {
    if flag == 0 {
        return None;
    }
    let count = dimension.max(1) as usize;
    Some(values.iter().take(count).copied().collect())
}

unsafe fn convert_param(raw: &RawParamInfo) -> ParamInfo {
    let kind = take_string(raw.kind);
    let dimension = raw.dimension.max(0) as u32;
    let default_value = match kind.as_str() {
        "string" | "custom" | "bytes" | "strchoice" => {
            if raw.string_default.is_null() {
                Value::String(String::new())
            } else {
                Value::String(take_string(raw.string_default))
            }
        }
        "boolean" => Value::Bool(raw.int_defaults[0] != 0),
        "integer" | "choice" | "integer2d" | "integer3d" => {
            if dimension > 1 {
                Value::Array(
                    raw.int_defaults
                        .iter()
                        .take(dimension as usize)
                        .map(|value| Value::from(*value))
                        .collect(),
                )
            } else {
                Value::from(raw.int_defaults[0])
            }
        }
        _ => {
            if dimension > 1 {
                Value::Array(
                    raw.defaults
                        .iter()
                        .take(dimension as usize)
                        .map(|value| Value::from(*value))
                        .collect(),
                )
            } else {
                Value::from(raw.defaults[0])
            }
        }
    };

    ParamInfo {
        name: take_string(raw.name),
        label: take_string(raw.label),
        param_type: kind,
        hint: take_string(raw.hint),
        parent: take_string(raw.parent),
        secret: raw.secret != 0,
        enabled: raw.enabled != 0,
        dimension,
        default_value,
        min: optional_values(raw.has_min, &raw.min, dimension),
        max: optional_values(raw.has_max, &raw.max, dimension),
        display_min: optional_values(raw.has_display_min, &raw.display_min, dimension),
        display_max: optional_values(raw.has_display_max, &raw.display_max, dimension),
        increment: optional_values(raw.has_increment, &raw.increment, dimension),
        digits: raw.digits,
        choices: take_string_list(raw.choices, raw.choice_count),
    }
}

unsafe fn convert_plugin(raw: &RawPluginInfo) -> PluginInfo {
    let params = if raw.params.is_null() || raw.param_count <= 0 {
        Vec::new()
    } else {
        std::slice::from_raw_parts(raw.params, raw.param_count as usize)
            .iter()
            .map(|item| unsafe { convert_param(item) })
            .collect()
    };
    PluginInfo {
        identifier: take_string(raw.identifier),
        name: take_string(raw.name),
        label: take_string(raw.label),
        grouping: take_string(raw.grouping),
        version: take_string(raw.version),
        plugin_api: take_string(raw.plugin_api),
        api_version: raw.api_version,
        version_major: raw.version_major,
        version_minor: raw.version_minor,
        context: take_string(raw.context),
        contexts: take_string_list(raw.contexts, raw.context_count),
        pixel_depths: take_string_list(raw.pixel_depths, raw.pixel_depth_count),
        clips: take_string_list(raw.clips, raw.clip_count),
        params,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn params_from_json_handles_numbers_bools_strings_and_colors() {
        let mut map = Map::new();
        map.insert("amount".into(), json!(0.5));
        map.insert("enabled".into(), json!(true));
        map.insert("title".into(), json!("hello"));
        map.insert("tint".into(), json!([1, 0.5, 0.25, 1]));
        map.insert("ignored".into(), Value::Null);

        let params = params_from_json(&map);
        assert_eq!(params.len(), 4);
        let amount = params.iter().find(|p| p.name == "amount").unwrap();
        assert_eq!(amount.doubles[0], 0.5);
        let enabled = params.iter().find(|p| p.name == "enabled").unwrap();
        assert_eq!(enabled.int, 1);
        let tint = params.iter().find(|p| p.name == "tint").unwrap();
        assert_eq!(tint.doubles, [1.0, 0.5, 0.25, 1.0]);
    }
}
