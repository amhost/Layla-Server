import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WelcomeModal } from "./WelcomeModal";
import UserSettingsService, {
  UserSettingKey,
} from "../services/user-settings-service";

describe("WelcomeModal", () => {
  it("renders nothing while hidden", () => {
    const { container } = render(<WelcomeModal visible={false} onClose={vi.fn()} />);

    expect(container.innerHTML).toBe("");
  });

  it("lists the recommended models with their download buttons", () => {
    render(<WelcomeModal visible onClose={vi.fn()} />);

    expect(screen.getByText("SERVER INITIALIZATION")).toBeTruthy();
    expect(screen.getByText("GPT OSS 20B")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "DOWNLOAD" })).toHaveLength(4);
  });

  it("opens the model download link externally", async () => {
    render(<WelcomeModal visible onClose={vi.fn()} />);

    await userEvent.click(screen.getAllByRole("button", { name: "DOWNLOAD" })[0]);

    expect(window.electronBridge.openExternal).toHaveBeenCalledWith(
      expect.stringContaining("gpt-oss-20b-Q4_K_M.gguf"),
    );
  });

  it("swallows errors raised while opening a download link", async () => {
    vi.mocked(window.electronBridge.openExternal).mockImplementation(() => {
      throw new Error("no shell");
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<WelcomeModal visible onClose={vi.fn()} />);
    await userEvent.click(screen.getAllByRole("button", { name: "DOWNLOAD" })[0]);

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("keeps the start button disabled until a model file is picked", async () => {
    vi.mocked(window.electronBridge.openFileDialog).mockResolvedValue(null);

    render(<WelcomeModal visible onClose={vi.fn()} />);

    const start = screen.getByRole("button", {
      name: "Waiting for model selection...",
    });
    expect(start).toHaveProperty("disabled", true);

    await userEvent.click(screen.getByText("BROWSE LOCAL FILES"));

    expect(
      screen.getByRole("button", { name: "Waiting for model selection..." }),
    ).toHaveProperty("disabled", true);
  });

  it("persists the picked model path and enables start", async () => {
    vi.mocked(window.electronBridge.openFileDialog).mockResolvedValue(
      "/models/picked.gguf",
    );
    const onClose = vi.fn();

    render(<WelcomeModal visible onClose={onClose} />);
    await userEvent.click(screen.getByText("BROWSE LOCAL FILES"));

    await waitFor(() => screen.getByText("MODEL SELECTED"));
    expect(screen.getByText("/models/picked.gguf")).toBeTruthy();
    await waitFor(async () =>
      expect(
        await UserSettingsService.getSetting(UserSettingKey.MODEL_PATH),
      ).toBe("/models/picked.gguf"),
    );

    await userEvent.click(screen.getByRole("button", { name: "Start" }));

    expect(onClose).toHaveBeenCalledWith("/models/picked.gguf");
  });
});
