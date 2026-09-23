import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ZHIPU_OFFICIAL_PLANS_ENABLED,
  isZhipuOfficialPlanDisabled,
} from "../src/lib/officialPlanAvailability.js";

test("UI disables official plan access without blocking ordinary API templates", async () => {
  const { config } = JSON.parse(
    await readFile(new URL("../../../config/provider/zcode-builtin.json", import.meta.url), "utf8"),
  );
  assert.equal(ZHIPU_OFFICIAL_PLANS_ENABLED, false);
  const templates = config.providerConfigRules.templateRules;
  assert.deepEqual(
    templates
      .filter((template: any) => isZhipuOfficialPlanDisabled(template.config.access?.type))
      .map((template: any) => template.templateId)
      .sort(),
    ["bigmodel-api", "zai-api"],
  );
  for (const id of ["zai-standard-api", "bigmodel-standard-api", "openai"]) {
    const template = templates.find((item: any) => item.templateId === id);
    assert.ok(template);
    assert.equal(isZhipuOfficialPlanDisabled(template.config.access?.type), false);
  }
  assert.equal(isZhipuOfficialPlanDisabled("zhipu-account"), true);
  assert.equal(isZhipuOfficialPlanDisabled("api-key"), false);
});
