/**
 * 修改版（fork）的编译期开关集中在此，避免散落修改上游 env.ts。
 * 上游行为保留原实现，仅在调用点按开关短路，rebase 时冲突面最小。
 */

/** 修改版没有对应的官方更新包；保留 production 身份也必须关闭官方更新，避免被官方包覆盖。 */
export const ZCODE_APP_UPDATES_ENABLED: boolean = false;

/** 修改版关闭营销投放、轮询与活动交互上报，不读取运行时开关。 */
export const ZCODE_MARKETING_TOUCH_ENABLED: boolean = false;

/** 保留上游渠道实现；当前发行仅在前端关闭智谱/Z.ai 官方套餐入口。 */
export const ZHIPU_OFFICIAL_PLANS_ENABLED: boolean = false;
