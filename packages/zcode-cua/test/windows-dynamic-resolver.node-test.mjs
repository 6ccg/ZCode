import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Extract the real declaration without evaluating node.ts's unrelated service graph.
// Use the real pure candidate recognizer; do not evaluate unrelated service construction.
const source = await readFile(new URL("../../services/src/node.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("node.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const declaration = ast.statements.find(
  (node) =>
    ts.isFunctionDeclaration(node) &&
    node.name?.text === "createDynamicCuaProductMcpServerResolver",
);
assert.ok(declaration, "dynamic resolver declaration must exist");
const js = ts.transpileModule(declaration.getText(ast), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const predicate = `import { isPotentialZCodeCuaAgentMcpServer } from ${JSON.stringify(
  new URL("../broker-server.js", import.meta.url).href,
)};\n`;
const { createDynamicCuaProductMcpServerResolver } = await import(
  `data:text/javascript;base64,${Buffer.from(predicate + js).toString("base64")}`
);
const ordinary = { name: "files", command: "files-mcp" };
const cua = { name: "computer-use", command: "cua-mcp" };
const other = { name: "search", command: "search-mcp" };
const servers = [ordinary, cua, other];
const failure = new Error("helper cold start failed");
test("preparation startup failure removes only CUA and preserves unrelated MCP", async () => {
  const errors = [];
  const resolver = createDynamicCuaProductMcpServerResolver({
    isPluginEnabled: () => true,
    getResolver: async () => {
      throw failure;
    },
    onPreparationError: (error) => errors.push(error),
  });
  const result = await resolver.resolveMcpServers(servers);
  assert.deepEqual(result, [ordinary, other]);
  assert.equal(result[0], ordinary);
  assert.equal(result[1], other);
  assert.deepEqual(servers, [ordinary, cua, other]);
  assert.deepEqual(errors, [failure]);
});

test("startup failure with no CUA candidates does not abort ordinary sessions", async () => {
  const resolver = createDynamicCuaProductMcpServerResolver({
    isPluginEnabled: () => true,
    getResolver: async () => {
      throw failure;
    },
  });
  assert.deepEqual(await resolver.resolveMcpServers([ordinary, other]), [ordinary, other]);
  assert.equal(await resolver.resolveMcpServers(undefined), undefined);
});
test("explicit restart and permission restart propagate startup errors", async () => {
  const resolver = createDynamicCuaProductMcpServerResolver({
    isPluginEnabled: () => true,
    getResolver: async () => {
      throw failure;
    },
  });
  await assert.rejects(resolver.restart(), (error) => error === failure);
  await assert.rejects(
    resolver.restartAfterPermissionGrant("session"),
    (error) => error === failure,
  );
});
test("disabled plugin preserves original servers without acquisition", async () => {
  const resolver = createDynamicCuaProductMcpServerResolver({
    isPluginEnabled: () => false,
    getResolver: () => assert.fail("must not acquire"),
  });
  assert.equal(await resolver.resolveMcpServers(servers), servers);
});
test("stale owner removes CUA after delegate await", async () => {
  const delegate = { resolveMcpServers: async () => servers };
  const resolver = createDynamicCuaProductMcpServerResolver({
    isPluginEnabled: () => true,
    getResolver: () => delegate,
    isResolverCurrent: () => false,
  });
  assert.deepEqual(await resolver.resolveMcpServers(servers), [ordinary, other]);
});
test("explicit restart propagates underlying delegate errors", async () => {
  const resolver = createDynamicCuaProductMcpServerResolver({
    isPluginEnabled: () => true,
    getResolver: () => ({
      restart: async () => {
        throw failure;
      },
      restartAfterPermissionGrant: async (session) => {
        assert.equal(session, "session");
        throw failure;
      },
    }),
  });
  await assert.rejects(resolver.restart(), (error) => error === failure);
  await assert.rejects(
    resolver.restartAfterPermissionGrant("session"),
    (error) => error === failure,
  );
});
