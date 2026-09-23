/** 保留上游渠道实现；当前发行仅在前端关闭智谱/Z.ai 官方套餐入口。 */
export const ZHIPU_OFFICIAL_PLANS_ENABLED = false;

export function isZhipuOfficialPlanDisabled(accessType?: string): boolean {
  return (
    !ZHIPU_OFFICIAL_PLANS_ENABLED &&
    (accessType === "zhipu-coding-plan-api-key" || accessType === "zhipu-account")
  );
}
