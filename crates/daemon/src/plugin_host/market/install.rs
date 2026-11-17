//! 安装事务：校验 → 解包到临时目录 → 原子 rename → 写名册。
//!
//! 纪律：任何一步失败都不在 `store/` 里留半个插件；名册要么指向一个完整目录，
//! 要么完全不提这件事。托管安装**不落绝对路径**（数据目录可迁移）。

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use super::super::linked::{read_manifest, safe_id, store_dir};
use super::super::registry::{now_secs, PluginRecord};

/// 归档条目数上限。
const MAX_ENTRIES: usize = 10_000;
/// 解包后体积上限（512 MB）。
const MAX_BYTES: u64 = 512 * 1024 * 1024;

/// 把一个 `.tgz` 的字节装进托管目录。
///
/// `expected_sha256` 必填：索引里每个版本都必须带校验和。
pub fn install_bytes(
    root: &Path,
    bytes: &[u8],
    expected_sha256: &str,
    app_version: &str,
) -> Result<PluginRecord, String> {
    let actual = hex(&Sha256::digest(bytes));
    if !actual.eq_ignore_ascii_case(expected_sha256.trim()) {
        return Err(format!(
            "sha256 不匹配：期望 {expected_sha256}，实际 {actual}"
        ));
    }

    let store = root.join("store");
    std::fs::create_dir_all(&store).map_err(|error| format!("创建插件仓库目录失败：{error}"))?;
    let staging = store.join(format!(".tmp-{}", uuid::Uuid::new_v4()));
    if staging.exists() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    std::fs::create_dir_all(&staging).map_err(|error| format!("创建临时目录失败：{error}"))?;

    let result = (|| {
        extract(bytes, &staging)?;
        // npm tarball 的根目录叫 `package/`，普通 tgz 直接是插件根。两种都接受。
        let package_root = if staging.join(super::super::manifest::MANIFEST_FILE).is_file() {
            staging.clone()
        } else if staging
            .join("package")
            .join(super::super::manifest::MANIFEST_FILE)
            .is_file()
        {
            staging.join("package")
        } else {
            return Err(format!(
                "归档里没有 {}",
                super::super::manifest::MANIFEST_FILE
            ));
        };
        let (manifest, _) = read_manifest(&package_root)?;
        let final_dir = store_dir(root, &manifest.id, &manifest.version);
        if let Some(parent) = final_dir.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("创建版本目录失败：{error}"))?;
        }
        // 同版本重装：先把旧的挪开，失败再挪回来（不留半新半旧）。
        let backup = final_dir.with_extension("old");
        let had_old = final_dir.exists();
        if had_old {
            let _ = std::fs::remove_dir_all(&backup);
            std::fs::rename(&final_dir, &backup)
                .map_err(|error| format!("备份旧版本失败：{error}"))?;
        }
        if let Err(error) = std::fs::rename(&package_root, &final_dir) {
            if had_old {
                let _ = std::fs::rename(&backup, &final_dir);
            }
            return Err(format!("安装目录落位失败：{error}"));
        }
        if had_old {
            let _ = std::fs::remove_dir_all(&backup);
        }
        Ok(PluginRecord {
            id: manifest.id.clone(),
            version: manifest.version.clone(),
            kind: "store".to_string(),
            path: None,
            enabled: true,
            installed_at: now_secs(),
            updated_at: now_secs(),
            last_error: None,
        })
    })();

    let _ = std::fs::remove_dir_all(&staging);
    let record = result?;
    // 兼容性只在扫描期提示，不阻止安装（用户可以装完再升级宿主）。
    let _ = app_version;
    Ok(record)
}

/// 解 `.tgz` 到 `dest`：只允许普通文件与目录，拒绝对路径、`..`、链接。
fn extract(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let decoder = flate2::read::GzDecoder::new(bytes);
    let mut archive = tar::Archive::new(decoder);
    let mut total = 0u64;
    let entries = archive
        .entries()
        .map_err(|error| format!("读归档失败：{error}"))?;
    for (index, entry) in entries.enumerate() {
        if index >= MAX_ENTRIES {
            return Err(format!("归档条目超过 {MAX_ENTRIES} 个"));
        }
        let mut entry = entry.map_err(|error| format!("读归档条目失败：{error}"))?;
        let path = entry
            .path()
            .map_err(|error| format!("归档条目路径非法：{error}"))?
            .to_path_buf();
        if path.is_absolute()
            || path
                .components()
                .any(|part| matches!(part, std::path::Component::ParentDir))
        {
            return Err(format!("归档里有越界路径：{}", path.display()));
        }
        let kind = entry.header().entry_type();
        if kind.is_symlink() || kind.is_hard_link() {
            return Err(format!("归档里有链接条目：{}", path.display()));
        }
        if kind.is_dir() {
            std::fs::create_dir_all(dest.join(&path))
                .map_err(|error| format!("创建目录失败：{error}"))?;
            continue;
        }
        total += entry.header().size().unwrap_or(0);
        if total > MAX_BYTES {
            return Err("归档解包后超过 512 MB".to_string());
        }
        let target = dest.join(&path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("创建目录失败：{error}"))?;
        }
        let mut file =
            std::fs::File::create(&target).map_err(|error| format!("写文件失败：{error}"))?;
        std::io::copy(&mut entry, &mut file)
            .map_err(|error| format!("解包失败：{error}"))?;
    }
    Ok(())
}

/// 删掉一个插件的托管目录（连同名册记录由调用方处理）。`data/` 不动。
pub fn remove_store(root: &Path, id: &str) -> Result<(), String> {
    let dir = root.join("store").join(safe_id(id));
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|error| format!("删除插件目录失败：{error}"))?;
    }
    Ok(())
}

/// 每个插件只保留最新的 `keep` 个版本目录。
pub fn gc(root: &Path, keep: usize) {
    let store = root.join("store");
    let Ok(entries) = std::fs::read_dir(&store) else {
        return;
    };
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let Ok(versions) = std::fs::read_dir(entry.path()) else {
            continue;
        };
        let mut dirs: Vec<PathBuf> = versions
            .flatten()
            .map(|item| item.path())
            .filter(|path| path.is_dir())
            .collect();
        dirs.sort();
        if dirs.len() <= keep {
            continue;
        }
        for path in &dirs[..dirs.len() - keep] {
            let _ = std::fs::remove_dir_all(path);
        }
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn build_tgz(id: &str, version: &str, with_manifest: bool, extra: &[(&str, &str)]) -> Vec<u8> {
        let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
            Vec::new(),
            flate2::Compression::default(),
        ));
        if with_manifest {
            let manifest = format!(
                r#"{{"format":1,"id":"{id}","version":"{version}","engines":{{"aicut":"*"}},"client":"./client.js"}}"#
            );
            append(&mut builder, "aicut.plugin.json", manifest.as_bytes());
            append(&mut builder, "client.js", b"export default {id,apply(){}}\n");
        }
        for (name, content) in extra {
            append(&mut builder, name, content.as_bytes());
        }
        builder.into_inner().unwrap().finish().unwrap()
    }

    /// 故意写一个越界路径的条目（`append_data` 会先拦下 `..`，这里直接改头部字节）。
    fn append_unsafe<W: std::io::Write>(builder: &mut tar::Builder<W>, name: &str, bytes: &[u8]) {
        let mut header = tar::Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_mode(0o644);
        header.set_entry_type(tar::EntryType::Regular);
        let raw = header.as_mut_bytes();
        let name_bytes = name.as_bytes();
        let len = name_bytes.len().min(100);
        raw[..len].copy_from_slice(&name_bytes[..len]);
        header.set_cksum();
        builder.append(&header, bytes).unwrap();
    }

    fn append<W: std::io::Write>(builder: &mut tar::Builder<W>, name: &str, bytes: &[u8]) {
        let mut header = tar::Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        builder.append_data(&mut header, name, bytes).unwrap();
    }

    fn sha(bytes: &[u8]) -> String {
        hex(&Sha256::digest(bytes))
    }

    #[test]
    fn installs_a_tgz_into_the_store() {
        let root = TempDir::new().unwrap();
        let bytes = build_tgz("@demo/tgz", "0.1.0", true, &[]);
        let record = install_bytes(root.path(), &bytes, &sha(&bytes), "1.4.0").unwrap();
        assert_eq!(record.id, "@demo/tgz");
        assert_eq!(record.kind, "store");
        assert!(record.path.is_none());
        let dir = store_dir(root.path(), "@demo/tgz", "0.1.0");
        assert!(dir.join("client.js").is_file());
    }

    #[test]
    fn accepts_the_npm_package_prefix() {
        let root = TempDir::new().unwrap();
        let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
            Vec::new(),
            flate2::Compression::default(),
        ));
        append(
            &mut builder,
            "package/aicut.plugin.json",
            br#"{"format":1,"id":"@demo/npm","version":"0.1.0","client":"./c.js"}"#,
        );
        append(&mut builder, "package/c.js", b"export default {}\n");
        let bytes = builder.into_inner().unwrap().finish().unwrap();
        let record = install_bytes(root.path(), &bytes, &sha(&bytes), "1.4.0").unwrap();
        assert_eq!(record.id, "@demo/npm");
        assert!(store_dir(root.path(), "@demo/npm", "0.1.0")
            .join("c.js")
            .is_file());
    }

    #[test]
    fn rejects_a_sha256_mismatch() {
        let root = TempDir::new().unwrap();
        let bytes = build_tgz("@demo/tgz", "0.1.0", true, &[]);
        let error = install_bytes(root.path(), &bytes, &"0".repeat(64), "1.4.0").unwrap_err();
        assert!(error.contains("sha256"), "{}", error);
        assert_eq!(
            std::fs::read_dir(root.path().join("store"))
                .map(|items| items.count())
                .unwrap_or(0),
            0
        );
    }

    #[test]
    fn rejects_an_archive_without_a_manifest() {
        let root = TempDir::new().unwrap();
        let bytes = build_tgz("@demo/tgz", "0.1.0", false, &[("readme.txt", "hi")]);
        let error = install_bytes(root.path(), &bytes, &sha(&bytes), "1.4.0").unwrap_err();
        assert!(error.contains("aicut.plugin.json"), "{}", error);
    }

    #[test]
    fn rejects_path_traversal_inside_the_archive() {
        let root = TempDir::new().unwrap();
        let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
            Vec::new(),
            flate2::Compression::default(),
        ));
        append(
            &mut builder,
            "aicut.plugin.json",
            br#"{"format":1,"id":"@demo/tgz","version":"0.1.0","client":"./c.js"}"#,
        );
        append_unsafe(&mut builder, "../escape.txt", b"boom");
        let bytes = builder.into_inner().unwrap().finish().unwrap();
        let error = install_bytes(root.path(), &bytes, &sha(&bytes), "1.4.0").unwrap_err();
        assert!(error.contains("越界"), "{}", error);
        assert!(!root.path().parent().unwrap().join("escape.txt").exists());
    }

    #[test]
    fn reinstalling_the_same_version_replaces_it() {
        let root = TempDir::new().unwrap();
        let first = build_tgz("@demo/tgz", "0.1.0", true, &[("extra.txt", "one")]);
        install_bytes(root.path(), &first, &sha(&first), "1.4.0").unwrap();
        let second = build_tgz("@demo/tgz", "0.1.0", true, &[("extra.txt", "two")]);
        install_bytes(root.path(), &second, &sha(&second), "1.4.0").unwrap();
        let dir = store_dir(root.path(), "@demo/tgz", "0.1.0");
        assert_eq!(
            std::fs::read_to_string(dir.join("extra.txt")).unwrap(),
            "two"
        );
    }

    #[test]
    fn gc_keeps_the_newest_versions() {
        let root = TempDir::new().unwrap();
        for version in ["0.1.0", "0.2.0", "0.3.0", "0.4.0"] {
            let bytes = build_tgz("@demo/tgz", version, true, &[]);
            install_bytes(root.path(), &bytes, &sha(&bytes), "1.4.0").unwrap();
        }
        gc(root.path(), 2);
        let dir = root.path().join("store").join(safe_id("@demo/tgz"));
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(names, vec!["0.3.0", "0.4.0"]);
    }

    #[test]
    fn remove_store_deletes_the_plugin_directory_only() {
        let root = TempDir::new().unwrap();
        let bytes = build_tgz("@demo/tgz", "0.1.0", true, &[]);
        install_bytes(root.path(), &bytes, &sha(&bytes), "1.4.0").unwrap();
        std::fs::create_dir_all(root.path().join("data").join("@demo-tgz")).unwrap();
        remove_store(root.path(), "@demo/tgz").unwrap();
        assert!(!root.path().join("store").join("@demo-tgz").exists());
        assert!(root.path().join("data").join("@demo-tgz").exists());
    }
}
