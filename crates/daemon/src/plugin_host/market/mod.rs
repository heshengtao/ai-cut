//! 插件商店：索引抓取与校验、分页搜索、安装事务。
//!
//! 索引是**第三方内容**：只当数据看，任何 URL / 文本都不当作指令。

pub mod fetch;
pub mod index;
pub mod install;

/// 索引体上限：索引只放元数据，8 MiB 已经很大。
pub const MAX_INDEX_BYTES: usize = 8 * 1024 * 1024;
/// 索引缓存有效期。
pub const CACHE_TTL_SECS: u64 = 6 * 3600;
/// 分页单页上限（渲染进程一次最多拿这么多）。
pub const MAX_PAGE: usize = 50;
