import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";

// This is independent source, not a wrapper around the distributed CUA helper.
// Requests are JSON argv data, never interpolated into executable source.
const NATIVE_SOURCE = String.raw`
function run(argv) {
  var dispatched = false;
  function fail(code, message) { var e = new Error(message); e.code = code; throw e; }
  function read(fn, fallback) { try { return fn(); } catch (_) { return fallback; } }
  function text(value) { return value === undefined || value === null ? "" : String(value); }
  var ui = Application.currentApplication(); ui.includeStandardAdditions = true;
  function consent(message) {
    try { ui.displayDialog(message, {withTitle: "Experimental Computer Use", buttons: ["Cancel", "Allow once"], defaultButton: "Cancel", cancelButton: "Cancel"}); }
    catch (_) { fail("permission_denied", "Local consent was not granted."); }
  }
  function blocked(name) { return /zcode|system events|osascript|script editor|system settings|system preferences|securityagent|authorizationhost|loginwindow/i.test(name); }
  try {
    var req = JSON.parse(argv[0]);
    if (req.operation === "request_access") {
      consent("Allow this request to explain experimental Computer Use access? No permissions will be changed automatically.");
      return JSON.stringify({ok:true, result:{available:true, permissionsGranted:false, message:"Grant Automation and Accessibility manually in macOS when needed. No access check or grant was performed."}});
    }
    var se = Application("System Events");
    if (req.operation === "list_apps") {
      consent("Share the names and process IDs of running foreground-capable applications with this local assistant call?");
      var apps = se.applicationProcesses().filter(function(p) { return !read(function(){return p.backgroundOnly();},true) && !blocked(text(p.name())); }).map(function(p) {return {pid:p.unixId(),name:text(p.name()),bundle_id:read(function(){return p.bundleIdentifier();},"")};});
      return JSON.stringify({ok:true,result:apps});
    }
    if (req.operation !== "observe" && req.operation !== "act") fail("unimplemented", "Unsupported backend operation.");
    if (req.operation === "observe") consent("Share the foreground target application's accessibility tree, including visible text and field values, with this assistant? Protected controls are excluded. Target: " + JSON.stringify(req.args.app_ref || {}) + "");
    var ref = req.args.app_ref || {};
    var matches = se.applicationProcesses().filter(function(p) {
      if (ref.pid !== undefined && p.unixId() !== ref.pid) return false;
      if (ref.name && text(p.name()) !== ref.name) return false;
      if (ref.bundle_id && read(function(){return p.bundleIdentifier();},"") !== ref.bundle_id) return false;
      return ref.pid !== undefined || !!ref.name || !!ref.bundle_id;
    });
    if (matches.length !== 1) fail("invalid_request", "Target must identify exactly one running application.");
    var proc = matches[0];
    var app = {pid:proc.unixId(),name:text(proc.name()),bundle_id:read(function(){return proc.bundleIdentifier();},"")};
    if (blocked(app.name) || blocked(app.bundle_id)) fail("not_authorized", "Automation and permission applications are excluded.");
    function foreground() { if (!proc.frontmost()) fail("foreground_required", "Target must already be foreground; automatic activation is unsupported."); }
    function snapshot() {
      foreground();
      var rows = [], refs = [], incomplete = false;
      function bounded(value) { var result = text(value); if (result.length > 512) { incomplete = true; return result.slice(0,512); } return result; }
      function visit(el, path, depth, unsafeParent) {
        if (rows.length >= 200 || depth > 8) { incomplete = true; return; }
        var role = text(read(function(){return el.role();},""));
        // 安全元数据读取失败不等于“不受保护”；无法确认时不读取值或遍历子节点。
        var safetyKnown = true, subrole = "";
        try { subrole = el.subrole(); if (typeof subrole !== "string") safetyKnown = false; }
        catch (_) { safetyKnown = false; }
        var title = bounded(read(function(){return el.name();},""));
        var protectedContent = false;
        try {
          var protection = el.attributes().filter(function(attribute){return attribute.name() === "AXProtectedContent";});
          // 成功枚举但不存在可选属性，与枚举/读取异常严格区分。
          if (protection.length) {
            var protectionValue = protection[0].value();
            if (typeof protectionValue !== "boolean") safetyKnown = false;
            else protectedContent = protectionValue;
          }
        } catch (_) { safetyKnown = false; }
        var unsafe = unsafeParent || !safetyKnown || !role || protectedContent || /secure|password|protected/i.test(role + " " + subrole + " " + title) || /dialog|sheet/i.test(role + " " + subrole);
        var value = unsafe ? "[excluded]" : bounded(read(function(){return el.value();},""));
        var actions = unsafe ? [] : read(function(){return el.actions().map(function(a){return text(a.name());});},[]);
        if (actions.length > 32) { incomplete = true; actions = actions.slice(0,32); }
        actions = actions.map(bounded);
        var settable = !unsafe && read(function(){return el.attributes.byName("AXValue").settable();},false) === true;
        rows.push({index:rows.length,kind:role,title:unsafe ? "[excluded]" : title,value:value,actions:actions,path:path,subrole:subrole,excluded:unsafe,settable:settable});
        refs.push(el);
        if (unsafe) return;
        var children;
        try { children = el.uiElements(); } catch (_) { incomplete = true; return; }
        for (var i=0;i<children.length;i++) visit(children[i],path.concat([i]),depth+1,unsafe);
      }
      var windows = proc.windows();
      for (var w=0;w<windows.length;w++) visit(windows[w],[w],0,false);
      return {state:{app:app,rows:rows,incomplete:incomplete},refs:refs};
    }
    var current = snapshot();
    if (req.operation === "observe") {
      return JSON.stringify({ok:true,result:{app:app,window:{title:current.state.rows.length ? current.state.rows[0].title : ""},elements:current.state.rows,text:"Experimental foreground AX snapshot; no screenshots or coordinates.\n" + current.state.rows.map(function(row){return "[" + row.index + "] " + row.kind + " " + JSON.stringify(row.title) + " value=" + JSON.stringify(row.value) + " actions=" + JSON.stringify(row.actions);}).join("\n") + (current.state.incomplete ? "\nSnapshot incomplete; mutations disabled." : ""),backendState:current.state}});
    }
    if (req.method !== "set_value" && req.method !== "perform_action") fail("unimplemented", "Only set_value and perform_action are supported.");
    if (!req.backendState || current.state.incomplete || JSON.stringify(current.state) !== JSON.stringify(req.backendState)) fail("element_unavailable", "AX snapshot changed or is incomplete; observe again.");
    var target = req.args.target;
    if (!target || target.type !== "element" || !Number.isInteger(target.index)) fail("invalid_request", "An observed element index is required.");
    var row = current.state.rows[target.index];
    if (!row || row.excluded) fail("not_authorized", "Protected, permission and dialog targets are excluded.");
    if (req.method === "set_value" && (!row.settable || typeof req.args.value !== "string")) fail("not_settable", "Target has no writable AXValue.");
    if (req.method === "perform_action" && row.actions.indexOf(req.args.action) < 0) fail("action_unavailable", "Action was not advertised by this element.");
    consent("Allow one accessibility action in " + app.name + " (PID " + app.pid + ")?\nTarget: " + row.kind + " / " + row.title + " / index " + row.index + "\n" + (req.method === "set_value" ? "Set value to: " + JSON.stringify(req.args.value) : "Perform action: " + req.args.action));
    // Re-read after consent: the dialog may change focus or the application tree.
    var fresh = snapshot();
    if (JSON.stringify(fresh.state) !== JSON.stringify(req.backendState)) fail("element_unavailable", "Target changed during confirmation; observe again.");
    // 遍历 AX 树期间焦点可能改变；派发前再次检查，不能只依赖遍历入口的检查。
    foreground();
    dispatched = true;
    if (req.method === "set_value") fresh.refs[target.index].attributes.byName("AXValue").value = req.args.value;
    else fresh.refs[target.index].actions.byName(req.args.action).perform();
    return JSON.stringify({ok:true,result:{action_sent:true,dispatch_status:"sent"}});
  } catch (e) {
    return JSON.stringify({ok:false,error:{code:e.code || "internal",message:e.code ? e.message : "macOS automation failed; check permissions and re-observe.",actionSent:dispatched}});
  }
}
`;

function backendError(code, message, actionSent = false) {
  return Object.assign(new Error(message), { code, actionSent });
}

/** execFile injection is an async (file, argv, options) => { stdout } test port. */
export function createMacOSBackend({
  execFile = promisify(nodeExecFile),
  platform = process.platform,
} = {}) {
  async function invoke(operation, args = {}, context = {}, method, backendState) {
    if (platform !== "darwin")
      throw backendError("unimplemented", "The source AX backend supports macOS only.");
    if (context.remoteSessionId || context.runtimeScope === "subagent") {
      throw backendError(
        "not_authorized",
        "Only local main sessions may use the source AX backend.",
      );
    }
    if (context.signal?.aborted) throw backendError("not_authorized", "Request was cancelled.");
    if (args.app_ref?.window_id !== undefined) {
      throw backendError(
        "unimplemented",
        "Window-specific references are unsupported; bind a foreground application instead.",
      );
    }
    if (args.include_screenshot || args.target?.type === "coordinate") {
      throw backendError("unimplemented", "Screenshots and coordinate input are unsupported.");
    }
    if (operation === "act" && !["set_value", "perform_action"].includes(method)) {
      throw backendError("unimplemented", "Only set_value and perform_action are supported.");
    }
    const payload = JSON.stringify({ operation, args, method, backendState });
    if (Buffer.byteLength(payload) > 128 * 1024)
      throw backendError("invalid_request", "AX request exceeds the bounded request size.");
    let stdout;
    try {
      ({ stdout } = await execFile(
        "/usr/bin/osascript",
        ["-l", "JavaScript", "-e", NATIVE_SOURCE, "--", payload],
        {
          encoding: "utf8",
          timeout: 120_000,
          maxBuffer: 1024 * 1024,
          signal: context.signal,
        },
      ));
    } catch {
      // A killed/failed subprocess may already have sent an action. Never retry it.
      throw backendError(
        "internal",
        "macOS automation did not return a receipt; re-observe before continuing.",
        operation === "act",
      );
    }
    let envelope;
    try {
      envelope = JSON.parse(stdout);
    } catch {
      throw backendError("internal", "Invalid macOS automation receipt.", operation === "act");
    }
    if (envelope.ok !== true)
      throw backendError(
        envelope.error?.code ?? "internal",
        envelope.error?.message ?? "macOS automation failed.",
        envelope.error?.actionSent === true,
      );
    return envelope.result;
  }
  return {
    requestAccess: (context) => invoke("request_access", {}, context),
    listApps: (context) => invoke("list_apps", {}, context),
    getAppState: (args, context) => invoke("observe", args, context),
    act: (method, args, context, backendState) =>
      invoke("act", args, context, method, backendState),
  };
}
