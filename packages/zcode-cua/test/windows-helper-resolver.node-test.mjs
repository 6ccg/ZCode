import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(
  new URL(
    "../../services/src/cua-permission-broker/windowsCuaHelperHostSupport.ts",
    import.meta.url,
  ),
  "utf8",
);
let js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
js = js.replaceAll(
  '"@zcode/zcode-cua/broker"',
  JSON.stringify(new URL("../broker.js", import.meta.url).href),
);
js = js.replaceAll(
  '"@zcode/zcode-cua/broker/server"',
  JSON.stringify(new URL("../broker-server.js", import.meta.url).href),
);
const { selectWindowsCuaHelperResolver } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);
function fixture() {
  const calls = [];
  const helper = {
    host: {
      start: async () => {
        calls.push("start");
      },
    },
    resolver: {},
  };
  let current = helper;
  const options = {
    bridgeEnabled: true,
    acquire: async () => {
      calls.push("acquire");
      return helper;
    },
    peek: () => {
      calls.push("peek");
      return current;
    },
    isCurrent: (value) => {
      calls.push("current");
      return value === current;
    },
  };
  return {
    calls,
    helper,
    options,
    invalidate: () => {
      current = undefined;
    },
  };
}
test("bridge acquires, starts, rechecks owner before returning resolver", async () => {
  const f = fixture();
  assert.equal(await selectWindowsCuaHelperResolver(f.options), f.helper.resolver);
  assert.deepEqual(f.calls, ["acquire", "current", "start", "current"]);
});
test("legacy selection remains peek-only", async () => {
  const f = fixture();
  assert.equal(
    await selectWindowsCuaHelperResolver({ ...f.options, bridgeEnabled: false }),
    f.helper.resolver,
  );
  assert.deepEqual(f.calls, ["peek", "current"]);
});
test("missing or stale acquired owner never starts", async () => {
  const f = fixture();
  f.invalidate();
  assert.equal(await selectWindowsCuaHelperResolver(f.options), undefined);
  assert.deepEqual(f.calls, ["acquire", "current"]);
  assert.equal(
    await selectWindowsCuaHelperResolver({ ...f.options, acquire: async () => undefined }),
    undefined,
  );
});
test("stop during delayed start fences stale resolver", async () => {
  const f = fixture();
  let release;
  let started;
  const starting = new Promise((resolve) => {
    started = resolve;
  });
  f.helper.host.start = async () => {
    started();
    await new Promise((resolve) => {
      release = resolve;
    });
  };
  const pending = selectWindowsCuaHelperResolver(f.options);
  await starting;
  f.invalidate();
  release();
  assert.equal(await pending, undefined);
});
test("start errors propagate without handing out resolver", async () => {
  const f = fixture();
  f.helper.host.start = async () => {
    throw new Error("startup failed");
  };
  await assert.rejects(selectWindowsCuaHelperResolver(f.options), /startup failed/);
});
