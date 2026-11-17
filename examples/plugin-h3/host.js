/**
 * 宿主半：multipart 提交 → 轮询 → 取直链 → 下载 → 返回本地路径。
 *
 * 这是「第三方代理 API」这类节点的通用形态：协议细节全在插件里，宿主只提供
 * `ctx.http` / `ctx.media` / `ctx.cancelled` 三个能力。
 */
globalThis.__AICUT_PLUGIN__ = {
  id: "@aicut/plugin-h3",
  run(input) {
    const args = JSON.parse(input);
    const base = String(args.base || "").replace(/\/+$/, "");
    if (!base) throw new Error("缺少接口基址");
    const headers = JSON.stringify({ "X-Card-Key": String(args.key || "") });

    const submit = JSON.parse(
      ctx.http.multipart(
        base + "/api/v1/tasks",
        JSON.stringify({
          task_name: "minimax_h3_v2",
          prompt: String(args.prompt || ""),
          resolution: "0.4",
          duration: "5",
        }),
        JSON.stringify(args.image ? { first_frame: args.image } : {}),
        headers,
        "POST",
      ),
    );
    if (submit.status !== 200 && submit.status !== 202) {
      throw new Error("提交失败：HTTP " + submit.status + " " + submit.text);
    }
    const taskId = JSON.parse(submit.text).data.task_id;

    for (let attempt = 0; attempt < 600; attempt += 1) {
      if (ctx.cancelled()) throw new Error("已取消");
      const poll = JSON.parse(
        ctx.http.request("GET", base + "/api/v1/tasks/" + taskId, headers, ""),
      );
      const status = JSON.parse(poll.text).data.status;
      if (status === "completed") break;
      if (status === "failed") throw new Error("任务失败：" + poll.text);
      const until = Date.now() + 200;
      while (Date.now() < until) {
        // QuickJS 里没有 sleep：宿主半的轮询就是同步等待。
      }
    }

    const fileUrl = JSON.parse(
      ctx.http.request("GET", base + "/api/v1/tasks/" + taskId + "/file-url", headers, ""),
    );
    const url = JSON.parse(fileUrl.text).data.url;
    return ctx.http.download(url, "", "h3.mp4");
  },
};
