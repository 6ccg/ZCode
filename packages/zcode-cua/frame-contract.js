import { externalWindowsCuaFunction } from "./src/external-windows-runtime.js";
export const OFFICIAL_CUA_FRAME_INTEGRITY_META_KEY = "zcode.cua/official-frame-integrity-v1";

export const OFFICIAL_CUA_FRAME_MODEL_CONTENT_PROTECTION = "official_cua_frame_v1";

export const OFFICIAL_CUA_IMAGE_INLINE_BASE64_BYTES = 200 * 1024;

export function isOfficialCuaImageRefText(_text) {
  const external = externalWindowsCuaFunction("./frame-contract", "isOfficialCuaImageRefText");
  if (external) return external(...arguments);
  return false;
}

export function containsOfficialCuaImageRefCredentialText(_text) {
  const external = externalWindowsCuaFunction(
    "./frame-contract",
    "containsOfficialCuaImageRefCredentialText",
  );
  if (external) return external(...arguments);
  return false;
}

export function containsImageRefAuthority(_text) {
  const external = externalWindowsCuaFunction("./frame-contract", "containsImageRefAuthority");
  if (external) return external(...arguments);
  return false;
}

export function parseOfficialCuaImageRef(_text) {
  const external = externalWindowsCuaFunction("./frame-contract", "parseOfficialCuaImageRef");
  if (external) return external(...arguments);
  return undefined;
}

export function readRasterEnvelopeIdentity(_input) {
  const external = externalWindowsCuaFunction("./frame-contract", "readRasterEnvelopeIdentity");
  if (external) return external(...arguments);
  return undefined;
}

export async function preserveOfficialCuaFrameResult(result) {
  const external = externalWindowsCuaFunction("./frame-contract", "preserveOfficialCuaFrameResult");
  if (external) return external(...arguments);
  return result;
}

export function attestOfficialCuaFrameContent(_content, _expectedKind) {
  const external = externalWindowsCuaFunction("./frame-contract", "attestOfficialCuaFrameContent");
  if (external) return external(...arguments);
  return undefined;
}

export function findOfficialCuaFrameContentPair(_content) {
  const external = externalWindowsCuaFunction(
    "./frame-contract",
    "findOfficialCuaFrameContentPair",
  );
  if (external) return external(...arguments);
  return undefined;
}
