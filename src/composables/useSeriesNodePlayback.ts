/**
 * 节点内联播放的单例仲裁：同一时刻只允许一张卡片在播。
 *
 * 卡片自己管理 `<video>`，这里只记住「当前在播的那张卡」的停止函数；另一张卡开始播时
 * 先把上一张停掉，避免画布上多个视频同时出声。
 */
let currentStop: (() => void) | null = null;

/** 申请成为当前播放卡片：会先停掉上一张。 */
export function claimSeriesNodePlayback(stop: () => void): void {
  if (currentStop && currentStop !== stop) currentStop();
  currentStop = stop;
}

/** 卡片停止 / 卸载时释放（只释放自己）。 */
export function releaseSeriesNodePlayback(stop: () => void): void {
  if (currentStop === stop) currentStop = null;
}
