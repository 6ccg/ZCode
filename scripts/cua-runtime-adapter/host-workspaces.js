// Computer Use component bridge. MIT license: see LICENSE.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { readFileSync, statSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
var CuaProductHelperWorkspaceRegistry = class {
  targetsByWorkspaceKey = /* @__PURE__ */ new Map();
  setEnabled(context, enabled) {
    if (context?.workspaceKey) {
      if (!enabled) {
        this.targetsByWorkspaceKey.delete(context.workspaceKey);
        return;
      }
      this.targetsByWorkspaceKey.set(context.workspaceKey, {
        workspacePath: context.workspacePath,
        ...(context.workspaceIdentity ? { workspaceIdentity: context.workspaceIdentity } : {}),
      });
    }
  }
  snapshot() {
    return [...this.targetsByWorkspaceKey.values()];
  }
  pruneDisabled(keep) {
    for (let [key, target] of this.targetsByWorkspaceKey)
      keep(target) || this.targetsByWorkspaceKey.delete(key);
  }
};
var OFFICIAL_CUA_PLUGIN_ID = "computer-use@zcode-plugins-official";
var PROJECT_CONFIG_CANDIDATES = ["zcode.json", join(".zcode", "config.json")],
  WORKTREE_MARKER = ".git";
function readJsonObject(path) {
  try {
    let parsed = JSON.parse(readFileSync(path, "utf8"));
    return typeof parsed == "object" && parsed !== null && !Array.isArray(parsed) ? parsed : void 0;
  } catch {
    return;
  }
}
function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
function hasWorktreeMarker(dir) {
  let marker = join(dir, WORKTREE_MARKER);
  try {
    if (!existsSync(marker)) return false;
    let stat = statSync(marker);
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}
function getProjectConfigDirectories(fromDir) {
  let chain = [],
    current = fromDir;
  for (;;) {
    if ((chain.push(current), hasWorktreeMarker(current))) return chain.reverse();
    let parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return [fromDir];
}
function discoverZCodeProjectConfigPaths(workingDirectory) {
  let start = resolvePath(workingDirectory ?? process.cwd());
  return getProjectConfigDirectories(start).flatMap((dir) =>
    PROJECT_CONFIG_CANDIDATES.map((name) => join(dir, name)).filter((path) => existsSync(path)),
  );
}
function resolveOfficialCuaPluginEnablementState(options) {
  let mcpEnabled = true,
    pluginsEnabled = true,
    pluginEnabled = false,
    configured = false,
    configPaths = [
      ...(options.userConfigPath ? [options.userConfigPath] : []),
      ...discoverZCodeProjectConfigPaths(options.workingDirectory),
      ...(options.projectConfigPath ? [options.projectConfigPath] : []),
    ];
  for (let path of configPaths) {
    let config = readJsonObject(path);
    if (config) {
      if (hasOwn(config, "features")) {
        let features = readJsonObjectValue(config.features);
        features
          ? hasOwn(features, "mcp") && (mcpEnabled = features.mcp === true)
          : (mcpEnabled = false);
      }
      if (hasOwn(config, "plugins")) {
        let plugins = readJsonObjectValue(config.plugins);
        if (!plugins) {
          ((pluginsEnabled = false), (pluginEnabled = false), (configured = true));
          continue;
        }
        if (
          (hasOwn(plugins, "enabled") && (pluginsEnabled = plugins.enabled === true),
          hasOwn(plugins, "enabledPlugins"))
        ) {
          let enabledPlugins = readJsonObjectValue(plugins.enabledPlugins);
          enabledPlugins
            ? (hasOwn(enabledPlugins, options.pluginId) &&
                (pluginEnabled = enabledPlugins[options.pluginId] === true),
              (configured = true))
            : ((pluginEnabled = false), (configured = true));
        }
      }
    }
  }
  return { configured, enabled: mcpEnabled && pluginsEnabled && pluginEnabled };
}
function readJsonObjectValue(value) {
  return typeof value == "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function isOfficialCuaPluginEnabledForWorkspace(options = {}) {
  let home = (options.env ?? process.env).HOME?.trim() || homedir();
  return resolveOfficialCuaPluginEnablementState({
    pluginId: OFFICIAL_CUA_PLUGIN_ID,
    workingDirectory: options.workingDirectory,
    projectConfigPath: options.projectConfigPath,
    userConfigPath: options.userConfigPath ?? join(home, ".zcode", "cli", "config.json"),
  }).enabled;
}
export { CuaProductHelperWorkspaceRegistry, isOfficialCuaPluginEnabledForWorkspace };
