export const CUA_REQUEST_ACCESS_STATUS_META_KEY = "zcode.cua/request-access-status-v1";

export const cuaRequestAccessStatusSchema = {
  safeParse(_input) {
    const external = loadExternalWindowsCuaModule("./request-access-contract");
    if (external) return external.cuaRequestAccessStatusSchema.safeParse(_input);
    return {
      success: false,
      error: new Error("Computer Use is not available in this build."),
    };
  },
};
import { loadExternalWindowsCuaModule } from "./src/external-windows-runtime.js";
