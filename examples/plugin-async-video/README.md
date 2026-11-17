# 示例插件：异步视频代理

演示「提交任务 → 轮询 → 取直链 → 下载」这类第三方生成服务的接入形态。**协议是通用的**：
不含任何真实厂商的地址、字段名或密钥。

- `client.js`：画布节点 `ext.asyncvideo.video`（接口基址、密钥、提示词、首帧）；
- `host.js`：在 daemon 的 QuickJS 里跑完整流程——
  1. `ctx.http.multipart` 提交 `POST {base}/tasks`；
  2. `ctx.http.request` 轮询 `GET {base}/tasks/{id}`；
  3. `GET {base}/tasks/{id}/file` 拿直链；
  4. `ctx.http.download` 落盘到 `data/<id>/out/output.mp4`，返回本地路径。

客户端半拿到路径后作为节点产物交给画布，自动入库。

## 试用

1. 「插件扩展」→「导入本地目录」选本目录；
2. 画布加「异步视频代理」节点，填接口基址与密钥；
3. 运行 → 产物是一段视频（服务得真的可用；本地联调可以用任意兼容这三个接口的 mock）。

真实的私有服务接入请放在**你自己的本地插件目录**里，不要提交到本仓库。
