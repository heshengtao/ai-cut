# 示例插件：H3 风格代理

演示「第三方视频生成代理」这类节点的最小形态，**不包含任何真实服务的地址或密钥**：

- `client.js`：画布节点 `ext.h3.video`（参数：接口基址、卡密钥、提示词、首帧）；
- `host.js`：在 daemon 的 QuickJS 里跑完整流程——
  1. `ctx.http.multipart` 提交 `POST /api/v1/tasks`；
  2. `ctx.http.request` 轮询 `GET /api/v1/tasks/{id}`；
  3. `GET /file-url` 拿签名直链；
  4. `ctx.http.download` 下载到 `data/<id>/out/h3.mp4`，返回本地路径。

客户端半拿到路径后作为节点产物交给画布，自动入库。

## 试用

1. 「插件扩展」→「导入本地目录」选本目录；
2. 画布加「H3 代理」节点，填接口基址与卡密钥；
3. 运行 → 产物是一段视频（代理服务得真的可用；本地联调用任意兼容这三个接口的 mock）。
