//! `ofx-host` — probe and render OpenFX image effects.
//!
//! This replaces the old sample `hostDemo`: it loads a real `.ofx` bundle,
//! prints the plugin/parameter table, and renders PPM/RGBA frames at the input
//! size (no fixed 720×576 canvas).

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Instant;

use clap::{Parser, Subcommand};
use ofx_host::ppm::Image;
use ofx_host::{params_from_json, probe, ParamInfo, PluginInfo, Session};
use serde_json::{Map, Value};

#[derive(Parser)]
#[command(
    name = "ofx-host",
    version,
    about = "Probe and render OpenFX image-effect bundles"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// List plugins and their parameters.
    Probe {
        /// Path to a .ofx.bundle, a .ofx binary, or a directory containing one.
        bundle: PathBuf,
        /// Only probe this plugin identifier.
        #[arg(long)]
        plugin: Option<String>,
        /// Force a context (e.g. OfxImageEffectContextFilter).
        #[arg(long)]
        context: Option<String>,
        /// Print machine-readable JSON instead of a table.
        #[arg(long)]
        json: bool,
    },

    /// Render one frame through a plugin.
    Render {
        /// Path to a .ofx.bundle, a .ofx binary, or a directory containing one.
        bundle: PathBuf,
        /// Plugin identifier (see `probe`).
        plugin: String,
        /// Input image: binary PPM (P6) or raw RGBA8.
        input: PathBuf,
        /// JSON object with parameter values; use `-` to read stdin.
        params: PathBuf,
        /// Output image: .ppm or .rgba.
        output: PathBuf,
        /// Force a context (e.g. OfxImageEffectContextFilter).
        #[arg(long)]
        context: Option<String>,
        /// Time in seconds passed to the effect.
        #[arg(long, default_value_t = 0.0)]
        time: f64,
        /// Width for raw .rgba input (PPM carries its own size).
        #[arg(long)]
        width: Option<u32>,
        /// Height for raw .rgba input (PPM carries its own size).
        #[arg(long)]
        height: Option<u32>,
    },
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("ofx-host: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<(), String> {
    match cli.command {
        Command::Probe {
            bundle,
            plugin,
            context,
            json,
        } => {
            let bundle_text = path_text(&bundle);
            let plugins = probe(&bundle_text, plugin.as_deref(), context.as_deref())?;
            if plugins.is_empty() {
                return Err("没有找到插件".to_string());
            }
            if json {
                let text = serde_json::to_string_pretty(&plugins)
                    .map_err(|error| format!("JSON 序列化失败：{error}"))?;
                println!("{text}");
            } else {
                print_plugins(&plugins);
            }
            Ok(())
        }
        Command::Render {
            bundle,
            plugin,
            input,
            params,
            output,
            context,
            time,
            width,
            height,
        } => {
            let bundle_text = path_text(&bundle);
            let image = ofx_host::ppm::read(&input, width, height)?;
            let map = read_params(&params)?;
            let values = params_from_json(&map);

            let started = Instant::now();
            let mut session = Session::open(
                &bundle_text,
                &plugin,
                context.as_deref(),
                image.width,
                image.height,
            )?;
            let rendered = session.render(time, &image.rgba, &values)?;
            let result = Image::new(image.width, image.height, rendered);
            ofx_host::ppm::write(&output, &result)?;
            let elapsed = started.elapsed().as_millis();
            println!(
                "rendered {} {}x{} @ {}s -> {} ({} ms)",
                plugin,
                image.width,
                image.height,
                time,
                output.display(),
                elapsed
            );
            Ok(())
        }
    }
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn read_params(path: &Path) -> Result<Map<String, Value>, String> {
    let text = if path == Path::new("-") {
        let mut buffer = String::new();
        std::io::stdin()
            .read_to_string(&mut buffer)
            .map_err(|error| format!("读取 stdin 失败：{error}"))?;
        buffer
    } else {
        fs::read_to_string(path)
            .map_err(|error| format!("读取参数 {} 失败：{error}", path.display()))?
    };
    if text.trim().is_empty() {
        return Ok(Map::new());
    }
    let value: Value =
        serde_json::from_str(&text).map_err(|error| format!("参数 JSON 解析失败：{error}"))?;
    value
        .as_object()
        .cloned()
        .ok_or_else(|| "参数 JSON 必须是对象，例如 {\"amount\": 0.5}".to_string())
}

fn print_plugins(plugins: &[PluginInfo]) {
    for (index, plugin) in plugins.iter().enumerate() {
        if index > 0 {
            println!();
        }
        println!("{}  {}", plugin.identifier, plugin.label);
        println!(
            "  version {}   api {} v{}   context {}",
            plugin.version, plugin.plugin_api, plugin.api_version, plugin.context
        );
        if !plugin.contexts.is_empty() {
            println!("  contexts: {}", plugin.contexts.join(", "));
        }
        if !plugin.pixel_depths.is_empty() {
            println!("  depths:   {}", plugin.pixel_depths.join(", "));
        }
        if !plugin.clips.is_empty() {
            println!("  clips:    {}", plugin.clips.join(", "));
        }
        println!("  params:   {}", plugin.params.len());
        if plugin.params.is_empty() {
            println!("    (no parameters)");
            continue;
        }
        println!();
        println!(
            "    {:<24} {:<10} {:<18} {:<26} enum",
            "name", "type", "default", "range"
        );
        println!("    {}", "-".repeat(108));
        for param in &plugin.params {
            let name = if param.label.is_empty() || param.label == param.name {
                param.name.clone()
            } else {
                format!("{} ({})", param.name, param.label)
            };
            println!(
                "    {:<24} {:<10} {:<18} {:<22} {}",
                truncate(&name, 24),
                truncate(&param.param_type, 10),
                truncate(&default_text(param), 18),
                truncate(&range_text(param), 26),
                enum_text(param)
            );
        }
    }
}

fn truncate(value: &str, width: usize) -> String {
    if value.chars().count() <= width {
        return value.to_string();
    }
    let mut out: String = value.chars().take(width.saturating_sub(1)).collect();
    out.push('…');
    out
}

fn format_number(value: f64, digits: i32) -> String {
    if digits > 0 {
        format!("{value:.digits$}", digits = digits as usize)
    } else if value.fract().abs() < 1e-9 {
        format!("{value:.0}")
    } else {
        let text = format!("{value:.6}");
        text.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

fn default_text(param: &ParamInfo) -> String {
    match &param.default_value {
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => format_number(number.as_f64().unwrap_or(0.0), param.digits),
        Value::String(text) => format!("\"{text}\""),
        Value::Array(items) => items
            .iter()
            .map(|item| match item {
                Value::Number(number) => {
                    format_number(number.as_f64().unwrap_or(0.0), param.digits)
                }
                other => other.to_string(),
            })
            .collect::<Vec<_>>()
            .join(","),
        other => other.to_string(),
    }
}

fn values_text(values: &Option<Vec<f64>>, digits: i32) -> Option<String> {
    let values = values.as_ref()?;
    Some(
        values
            .iter()
            .map(|value| format_number(*value, digits))
            .collect::<Vec<_>>()
            .join(","),
    )
}

fn range_text(param: &ParamInfo) -> String {
    let min = values_text(&param.display_min, param.digits)
        .or_else(|| values_text(&param.min, param.digits));
    let max = values_text(&param.display_max, param.digits)
        .or_else(|| values_text(&param.max, param.digits));
    let mut text = match (min, max) {
        (Some(min), Some(max)) => format!("{min}..{max}"),
        (Some(min), None) => format!("{min}.."),
        (None, Some(max)) => format!("..{max}"),
        (None, None) => "-".to_string(),
    };
    if let Some(increment) = values_text(&param.increment, param.digits) {
        text.push_str(&format!(" step {}", increment));
    }
    text
}

fn enum_text(param: &ParamInfo) -> String {
    if param.choices.is_empty() {
        return "-".to_string();
    }
    let default_index = if param.param_type == "choice" {
        param.default_value.as_i64()
    } else {
        None
    };
    param
        .choices
        .iter()
        .enumerate()
        .map(|(index, choice)| {
            if default_index == Some(index as i64) {
                format!("[{choice}]")
            } else {
                choice.clone()
            }
        })
        .collect::<Vec<_>>()
        .join("|")
}
