import type { DesktopPortableUpdatesContract } from "./contract.js";

export async function exampleDesktopPortableUpdates(
  updater: DesktopPortableUpdatesContract,
): Promise<void> {
  await updater.initialize();
  await updater.execute({
    action: "configure",
    preferences: {
      source: "https://api.github.com/repos/example/ZCode/releases/latest",
      automatic: false,
      autoDownload: false,
    },
  });
  await updater.execute({ action: "check" });
}
