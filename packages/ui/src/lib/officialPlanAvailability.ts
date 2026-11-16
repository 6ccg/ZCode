import { ZHIPU_OFFICIAL_PLANS_ENABLED } from "@zcode/shared";

export { ZHIPU_OFFICIAL_PLANS_ENABLED };

export function isZhipuOfficialPlanDisabled(accessType?: string): boolean {
  return (
    !ZHIPU_OFFICIAL_PLANS_ENABLED &&
    (accessType === "zhipu-coding-plan-api-key" || accessType === "zhipu-account")
  );
}
