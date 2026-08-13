import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UserSettingsService, {
  UserSettingKey,
} from "./services/user-settings-service";

vi.mock("qrcode", () => ({ toCanvas: vi.fn(), default: { toCanvas: vi.fn() } }));

async function mountApp() {
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  vi.resetModules();
  await import("./renderer");
  await waitFor(() => screen.getByText("Layla Server"));
  return root;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("renderer entrypoint", () => {
  it("does nothing when there is no #root container", async () => {
    vi.resetModules();
    await expect(import("./renderer")).resolves.toBeDefined();

    expect(screen.queryByText("Layla Server")).toBeNull();
  });

  it("mounts the server panel and toggles the settings overlay", async () => {
    await UserSettingsService.saveSetting(
      UserSettingKey.MODEL_PATH,
      "/models/gpt-oss-20b-Q4_K_M.gguf",
    );

    await mountApp();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    await waitFor(() => screen.getByRole("button", { name: "Save" }));

    await userEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    // going back bumps the refresh counter, which reloads settings in the panel
    await waitFor(() =>
      expect(window.electronBridge.showAlert).toHaveBeenCalledWith(
        "Settings updated",
        expect.any(String),
      ),
    );
  });
});
