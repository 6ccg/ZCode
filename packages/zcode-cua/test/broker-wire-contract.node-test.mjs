import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as broker from "../broker.js";

async function withPlatform(platform, runtimeRoot, run) {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  const originalRoot = process.env.ZCODE_CUA_RUNTIME_PACKAGE_DIR;
  Object.defineProperty(process, "platform", { value: platform });
  if (runtimeRoot === undefined) delete process.env.ZCODE_CUA_RUNTIME_PACKAGE_DIR;
  else process.env.ZCODE_CUA_RUNTIME_PACKAGE_DIR = runtimeRoot;
  try {
    return await run();
  } finally {
    Object.defineProperty(process, "platform", originalPlatform);
    if (originalRoot === undefined) delete process.env.ZCODE_CUA_RUNTIME_PACKAGE_DIR;
    else process.env.ZCODE_CUA_RUNTIME_PACKAGE_DIR = originalRoot;
  }
}

function fallbackTest(name, run) {
  test(name, () => withPlatform("linux", "/must-not-be-loaded", run));
}

fallbackTest("request parser preserves numeric IDs and normalizes omitted params", () => {
  for (const id of [0, 1, Number.MAX_SAFE_INTEGER]) {
    assert.deepEqual(broker.parseRequestLine(JSON.stringify({ id, method: "broker_info" })), {
      ok: true,
      request: { id, method: "broker_info", params: {} },
    });
  }
  assert.deepEqual(
    broker.parseRequestLine(
      JSON.stringify({
        id: 42,
        method: "unknown_future_method",
        params: { nested: [1] },
        extra: 1,
      }),
    ),
    { ok: true, request: { id: 42, method: "unknown_future_method", params: { nested: [1] } } },
  );
  // 方法存在性由 runtime 判断；纯线协议解析不擅自裁剪或拒绝非空方法名。
  assert.equal(broker.parseRequestLine('{"id":0,"method":" "}').ok, true);
});

fallbackTest(
  "request parser reports malformed JSON and non-object payloads without throwing",
  () => {
    for (const line of ["", "{", '{"id":1,}']) {
      assert.deepEqual(broker.parseRequestLine(line), {
        ok: false,
        id: 0,
        code: "invalid_request",
        message: "request is not valid JSON",
      });
    }
    for (const value of [null, false, true, 7, "request"]) {
      assert.deepEqual(broker.parseRequestLine(JSON.stringify(value)), {
        ok: false,
        id: 0,
        code: "invalid_request",
        message: "request must be a JSON object",
      });
    }
  },
);

fallbackTest(
  "request parser rejects missing, string, fractional and unsafe IDs with fallback ID 0",
  () => {
    const lines = ["[]", "{}", '{"method":"broker_info"}'];
    for (const id of [null, false, true, "1", -1, 0.5, Number.MAX_SAFE_INTEGER + 1, {}, []]) {
      lines.push(JSON.stringify({ id, method: "broker_info" }));
    }
    lines.push('{"id":1e309,"method":"broker_info"}');
    for (const line of lines) {
      assert.deepEqual(broker.parseRequestLine(line), {
        ok: false,
        id: 0,
        code: "invalid_request",
        message: "request.id must be a non-negative safe integer",
      });
    }
  },
);

fallbackTest("method and params errors retain a valid request ID", () => {
  for (const method of [undefined, "", null, 1, {}, []]) {
    assert.deepEqual(broker.parseRequestLine(JSON.stringify({ id: 9, method })), {
      ok: false,
      id: 9,
      code: "invalid_request",
      message: "request.method must be a non-empty string",
    });
  }
  for (const params of [null, false, 1, "params", []]) {
    assert.deepEqual(broker.parseRequestLine(JSON.stringify({ id: 9, method: "read", params })), {
      ok: false,
      id: 9,
      code: "invalid_request",
      message: "request.params must be an object",
    });
  }
});

fallbackTest(
  "success envelopes preserve request IDs, falsy results and opaque presentation",
  () => {
    for (const result of [undefined, null, false, 0, "", [], {}]) {
      assert.deepEqual(broker.okResponse(4, result), { id: 4, ok: true, result: result ?? null });
      assert.equal(Object.hasOwn(broker.okResponse(4, result), "presentation"), false);
    }
    const result = { value: 1 };
    const presentation = { frame: "opaque" };
    const response = broker.okResponse(4, result, presentation);
    assert.equal(response.result, result);
    assert.equal(response.presentation, presentation);
    assert.deepEqual(broker.okResponse(0, undefined, null), {
      id: 0,
      ok: true,
      result: null,
      presentation: null,
    });
  },
);

fallbackTest("error envelopes preserve codes and copy nonempty details only", () => {
  for (const details of [undefined, {}]) {
    assert.deepEqual(broker.errorResponse(5, "not_authorized", "denied", details), {
      id: 5,
      ok: false,
      error: { code: "not_authorized", message: "denied" },
    });
  }
  const details = { request_delivery_state: "not_sent", nested: { value: 1 } };
  const response = broker.errorResponse(5, "not_authorized", "denied", details);
  assert.deepEqual(response.error.details, details);
  assert.notEqual(response.error.details, details);
  assert.equal(response.error.details.nested, details.nested);
  details.request_delivery_state = "possibly_sent";
  assert.equal(response.error.details.request_delivery_state, "not_sent");
});

fallbackTest(
  "exception envelopes classify local and foreign Error instances without losing details",
  () => {
    const details = { request_delivery_state: "not_sent" };
    for (const error of [
      new broker.BrokerError("denied", { code: "not_authorized", details }),
      Object.assign(new Error("denied"), { code: "not_authorized", details }),
    ]) {
      assert.deepEqual(broker.errorResponseFromException(6, error), {
        id: 6,
        ok: false,
        error: { code: "not_authorized", message: "denied", details },
      });
    }
    for (const error of [
      new Error("failure"),
      Object.assign(new Error("failure"), { code: "" }),
      Object.assign(new Error("failure"), { code: 7 }),
      "failure",
      null,
      undefined,
      { code: "not_authorized", message: "not an Error" },
    ]) {
      assert.deepEqual(broker.errorResponseFromException(6, error), {
        id: 6,
        ok: false,
        error: {
          code: "internal",
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  },
);

fallbackTest(
  "serialized responses use newline framing and preserve error request correlation",
  () => {
    const parsed = broker.parseRequestLine('{"id":12,"method":""}');
    assert.equal(parsed.ok, false);
    const response = broker.errorResponse(parsed.id, parsed.code, parsed.message);
    const line = broker.serializeResponse(response);
    assert.equal(line, `${JSON.stringify(response)}\n`);
    assert.deepEqual(JSON.parse(line), response);
    assert.equal(broker.serializeResponse(broker.okResponse(13, "a\nb")).split("\n").length, 2);
  },
);

fallbackTest(
  "non-Windows effectful fallback calls stay unavailable and never invoke a backend",
  async () => {
    let invoked = false;
    const backend = {
      broker_info() {
        invoked = true;
        return { pid: 1 };
      },
    };
    await assert.rejects(
      broker.callBrokerMethod({ socketPath: "/not-a-socket", method: "broker_info" }),
      { name: "BrokerError", code: "unavailable" },
    );
    await assert.rejects(
      broker.dispatchRequest(backend, { id: 1, method: "broker_info", params: {} }),
      {
        name: "CuaHelperError",
        code: "helper_unavailable",
      },
    );
    for (const line of ['{"id":1,"method":"broker_info"}', "invalid JSON"]) {
      await assert.rejects(broker.handleRequestLine(backend, line), {
        name: "CuaHelperError",
        code: "helper_unavailable",
      });
    }
    assert.equal(invoked, false);
    assert.deepEqual(await broker.probeHelperHealth("/not-a-socket"), {
      bundleId: null,
      pid: null,
    });
    assert.equal(broker.isBrokerMethod("broker_info"), false);
  },
);

test("Windows wire and effectful delegates preserve all supplied arguments", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-broker-wire-"));
  const cases = [
    ["parseRequestLine", ['{"id":1,"method":"fixture"}']],
    ["okResponse", [1, { result: true }, { frame: "opaque" }]],
    ["errorResponse", [2, "fixture_error", "failed", { delivery: "not_sent" }]],
    ["errorResponseFromException", [3, new Error("fixture")]],
    ["serializeResponse", [{ id: 4, ok: true, result: null }]],
    ["dispatchRequest", [{ fixture() {} }, { id: 5, method: "fixture", params: {} }]],
    ["handleRequestLine", [{ fixture() {} }, '{"id":6,"method":"fixture"}']],
    [
      "callBrokerMethod",
      [
        {
          socketPath: "fixture",
          method: "fixture",
          params: { nested: [] },
          timeoutMs: 50,
          opaqueFutureOption: { signal: new AbortController().signal },
        },
      ],
    ],
  ];
  try {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "@zcode/zcode-cua",
        version: "0.0.0-fixture",
        type: "module",
        exports: { "./broker": "./broker.js" },
      }),
    );
    await writeFile(
      join(root, "broker.js"),
      cases.map(([name]) => `export function ${name}(...args) { return args; }`).join("\n"),
    );
    await withPlatform("win32", root, async () => {
      for (const [name, args] of cases) {
        const result = await broker[name](...args);
        assert.equal(result.length, args.length, name);
        args.forEach((arg, index) => assert.equal(result[index], arg, `${name} argument ${index}`));
      }
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
