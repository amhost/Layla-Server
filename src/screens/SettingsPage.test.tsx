import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsPage from "./SettingsPage";
import UserSettingsService, {
  USER_SETTING_DEFAULTS,
  UserSettingKey,
} from "../services/user-settings-service";

const serverUrlInput = () =>
  screen.getByPlaceholderText(
    "http://127.0.0.1:8080/v1/chat/completions",
  ) as HTMLInputElement;

async function renderSettings() {
  const onBack = vi.fn();
  render(<SettingsPage onBack={onBack} />);
  await waitFor(() => serverUrlInput());
  return { onBack };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SettingsPage", () => {
  it("shows the app version and the stored setting values once loaded", async () => {
    await UserSettingsService.saveSetting(
      UserSettingKey.MODEL_PATH,
      "/models/stored.gguf",
    );
    vi.mocked(window.electronBridge.getAppVersion).mockResolvedValue("9.9.9");

    await renderSettings();

    await waitFor(() => screen.getByText("(v9.9.9)"));
    expect(
      (screen.getByDisplayValue("/models/stored.gguf") as HTMLInputElement).value,
    ).toBe("/models/stored.gguf");
  });

  it("enables save only once a value is edited, then persists every setting", async () => {
    await renderSettings();

    const save = () => screen.getByRole("button", { name: "Save" });
    expect(save()).toHaveProperty("disabled", true);

    await userEvent.clear(serverUrlInput());
    await userEvent.type(serverUrlInput(), "http://localhost:9999/v1/x");
    expect(save()).toHaveProperty("disabled", false);

    await userEvent.click(save());

    await waitFor(() => screen.getByText("Settings saved"));
    expect(
      await UserSettingsService.getSetting(UserSettingKey.LOCAL_SERVER_URL),
    ).toBe("http://localhost:9999/v1/x");
    expect(save()).toHaveProperty("disabled", true);
  });

  it("reports a failure when persisting throws", async () => {
    const saveSetting = vi
      .spyOn(UserSettingsService, "saveSetting")
      .mockRejectedValue(new Error("quota exceeded"));

    await renderSettings();
    await userEvent.type(serverUrlInput(), "!");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => screen.getByText("Failed to save settings"));
    expect(saveSetting).toHaveBeenCalled();
  });

  it("resets a single modified setting back to its default", async () => {
    await renderSettings();

    await userEvent.clear(serverUrlInput());
    await userEvent.type(serverUrlInput(), "http://changed/v1");

    const resets = screen.getAllByRole("button", { name: "Reset" });
    await userEvent.click(resets[0]);

    expect(serverUrlInput().value).toBe(
      USER_SETTING_DEFAULTS[UserSettingKey.LOCAL_SERVER_URL],
    );
  });

  it("restores factory defaults for every setting", async () => {
    await UserSettingsService.saveSetting(
      UserSettingKey.MODEL_PATH,
      "/models/custom.gguf",
    );

    await renderSettings();
    await waitFor(() => screen.getByDisplayValue("/models/custom.gguf"));

    await userEvent.click(screen.getByRole("button", { name: "Reset Everything" }));

    expect(screen.queryByDisplayValue("/models/custom.gguf")).toBeNull();
    expect(serverUrlInput().value).toBe(
      USER_SETTING_DEFAULTS[UserSettingKey.LOCAL_SERVER_URL],
    );
  });

  it("fills a file setting from the native file dialog", async () => {
    vi.mocked(window.electronBridge.openFileDialog).mockResolvedValue(
      "/models/browsed.gguf",
    );

    await renderSettings();
    await userEvent.click(screen.getAllByRole("button", { name: "Browse" })[0]);

    await waitFor(() => screen.getByDisplayValue("/models/browsed.gguf"));
  });

  it("leaves a file setting untouched when the dialog is cancelled or fails", async () => {
    vi.mocked(window.electronBridge.openFileDialog)
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("dialog crashed"));

    await renderSettings();
    const browse = screen.getAllByRole("button", { name: "Browse" })[0];

    await userEvent.click(browse);
    await userEvent.click(browse);

    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("calls onBack when the back button is pressed", async () => {
    const { onBack } = await renderSettings();

    await userEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
