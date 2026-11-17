/** 商店索引里的一条搜索结果（daemon 已把它和本地名册对过账）。 */
export interface MarketSearchHit {
  name: string;
  title: string;
  description: string;
  icon: string | null;
  author: string | null;
  homepage: string | null;
  version: string;
  sha256: string;
  size: number;
  publishedAt: number;
  /** `npm` / `npm:<registry>` / 直链。 */
  source: string;
  installed: boolean;
  installedVersion: string | null;
  updateAvailable: boolean;
}

export interface MarketSearchResult {
  /** `network` / `cache` / `stale-cache`。 */
  source: string;
  fetchedAt: number;
  total: number;
  hits: MarketSearchHit[];
}
