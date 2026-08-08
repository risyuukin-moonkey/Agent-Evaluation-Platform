import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the agent evaluation platform shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Agent 自动化测试平台/);
  assert.match(html, /接口与Profile/);
  assert.match(html, /测试集/);
  assert.match(html, /运行测试/);
  assert.match(html, /报告复核/);
  assert.match(html, /基础可用性/);
  assert.match(html, /知识问答/);
  assert.doesNotMatch(html, /Your site is taking shape/);
  assert.doesNotMatch(html, /react-loading-skeleton/);
  assert.doesNotMatch(html, /codex-preview/);
});
