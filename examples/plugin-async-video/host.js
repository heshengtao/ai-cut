/**
 * 宿主半：一个**通用异步生成服务**的调用流程。
 *
 * 只演示协议形状（提交 → 轮询 → 取直链 → 下载），不含任何真实服务的地址、字段或密钥：
 *   POST {base}/tasks        multipart，返回 { id }
 *   GET  {base}/tasks/{id}   返回 { status: queued|running|done|failed }
 *   GET  {base}/tasks/{id}/file  返回 { url }
 */
globalThis.__AICUT_PLUGIN__ = {
  id: "@aicut/plugin-async-video",
  run(input) {
    const args = JSON.parse(input);
    const base = String(args.base || "").replace(/\/+$/, "");
    if (!base) throw new Error("缺少接口基址");
    const headers = JSON.stringify(
      args.key ? { Authorization: "Bearer " + String(args.key) } : {},
    );

    // 1) 提交
    const submit = JSON.parse(
      ctx.http.multipart(
        base + "/tasks",
        JSON.stringify({ prompt: String(args.prompt || ""), seconds: "5" }),
        JSON.stringify(args.image ? { first_frame: args.image } : {}),
        headers,
        "POST",
      ),
    );
    if (submit.status !== 200 && submit.status !== 202) {
      throw new Error("提交失败：HTTP " + submit.status + " " + submit.text);
    }
    const id = JSON.parse(submit.text).id;

    // 2) 轮询（同步等待：占的是本插件自己的线程）
    for (let attempt = 0; attempt < 600; attempt += 1) {
      if (ctx.cancelled()) throw new Error("已取消");
      const poll = JSON.parse(ctx.http.request("GET", base + "/tasks/" + id, headers, ""));
      const status = JSON.parse(poll.text).status;
      if (status === "done") break;
      if (status === "failed") throw new Error("任务失败：" + poll.text);
      const until = Date.now() + 200;
      while (Date.now() < until) {
        // QuickJS 没有 sleep，宿主半的轮询就是在这里空转。
      }
    }

    // 3) 取直链并下载
    const file = JSON.parse(
      ctx.http.request("GET", base + "/tasks/" + id + "/file", headers, ""),
    );
    return ctx.http.download(JSON.parse(file.text).url, "", "output.mp4");
  },
};
