// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  status: "loading" as "loading" | "ready" | "error",
  retry: vi.fn(),
  enabled: false,
}));
vi.mock("@/lib/officialPlanAvailability.js", () => ({
  get ZHIPU_OFFICIAL_PLANS_ENABLED() {
    return h.enabled;
  },
}));
vi.mock("@/settings/CodingPlanUpgradeDialogProvider.js", () => ({
  useOptionalCodingPlanUpgradeDialog: () => ({ inventory: { status: h.status, retry: h.retry } }),
}));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));
import { CodingPlanEntryButton } from "@/settings/CodingPlanEntryButton.js";
afterEach(() => {
  cleanup();
  h.enabled = false;
  h.status = "loading";
  vi.clearAllMocks();
});
it("disables loading, retries failure without purchasing, and requires a fresh ready click", () => {
  h.enabled = true;
  const purchase = vi.fn();
  const view = render(createElement(CodingPlanEntryButton, { onClick: purchase }, "Upgrade"));
  const button = screen.getByRole("button") as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(purchase).not.toHaveBeenCalled();
  h.status = "error";
  view.rerender(createElement(CodingPlanEntryButton, { onClick: purchase }, "Upgrade"));
  expect(button.textContent).toBe("purchase.entry.retry");
  fireEvent.click(button);
  expect(h.retry).toHaveBeenCalledTimes(1);
  expect(purchase).not.toHaveBeenCalled();
  h.status = "ready";
  view.rerender(createElement(CodingPlanEntryButton, { onClick: purchase }, "Upgrade"));
  expect(purchase).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(purchase).toHaveBeenCalledTimes(1);
});

it.each(["loading", "error", "ready"] as const)(
  "modified distribution blocks plan entry in %s state",
  (status) => {
    h.status = status;
    const purchase = vi.fn();
    render(createElement(CodingPlanEntryButton, { onClick: purchase }, "Upgrade"));
    const button = screen.getByRole("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(purchase).not.toHaveBeenCalled();
    expect(h.retry).not.toHaveBeenCalled();
  },
);
