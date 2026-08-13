import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LlmServerPanel from "./LLMServerPanel";
import { parked } from "../../test/parked-fetch";
import UserSettingsService, {
  UserSettingKey,
} from "../services/user-settings-service";

vi.mock("qrcode", () => ({ toCanvas: vi.fn(), default: { toCanvas: vi.fn() } }));

class FakeDataChannel {
  readyState = "connecting";
  label = "layla-datachannel";
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.onclose?.();
  });
  addEventListener = vi.fn();
}

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];
  connectionState = "new";
  iceConnectionState = "new";
  iceGatheringState = "complete";
  localDescription: { sdp: string } | null = null;
  dataChannel = new FakeDataChannel();
  onicecandidate: unknown = null;
  onconnectionstatechange: unknown = null;
  oniceconnectionstatechange: unknown = null;
  onicegatheringstatechange: unknown = null;

  constructor() {
    FakePeerConnection.instances.push(this);
  }

  createDataChannel = () => this.dataChannel;
  createOffer = async () => ({ type: "offer", sdp: "v=0 fake-offer" });
  setLocalDescription = async () => {
    this.localDescription = { sdp: "v=0 fake-offer" };
  };
  setRemoteDescription = vi.fn(async () => undefined);
  close = vi.fn();
}

/** Never-settling fetch keeps the signalling poll parked mid-request. */
function parkedFetch() {
  return vi.fn((_url: string, init?: RequestInit) => parked(init?.signal ?? undefined));
}

async function seedModel(path = "C:\\models\\Cydonia-24B-v4.3-Q4_K_M.gguf") {
  await UserSettingsService.saveSetting(UserSettingKey.MODEL_PATH, path);
  await UserSettingsService.saveSetting(
    UserSettingKey.LOCAL_SERVER_PATH,
    "C:\\server\\llama-server.exe",
  );
}

/** The header status line renders "Online"/"Offline" alongside the status text. */
const statusLine = () =>
  document.querySelector(".header-sub")?.textContent ?? "";

function renderPanel() {
  const goToSettings = vi.fn();
  const view = render(
    <LlmServerPanel goToSettings={goToSettings} settingsRefreshCounter={0} />,
  );
  return { goToSettings, view };
}

beforeEach(() => {
  FakePeerConnection.instances = [];
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
  vi.stubGlobal(
    "RTCSessionDescription",
    class {
      constructor(public init: { type: string; sdp: string }) {}
    },
  );
  vi.stubGlobal("fetch", parkedFetch());
});

afterEach(async () => {
  // Stop the server so the signalling retry loop does not outlive the test.
  for (const stop of screen.queryAllByRole("button", { name: "Stop server" })) {
    await userEvent.click(stop);
  }
  vi.unstubAllGlobals();
});

describe("LlmServerPanel", () => {
  it("starts offline with the welcome log entry", async () => {
    await seedModel();
    renderPanel();

    expect(statusLine()).toContain("Offline");
    expect(
      screen.getByText(/Click "START SERVER" to launch your local LLM server/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start server" })).toBeTruthy();
  });

  it("shows the model name and derived tags from the stored model path", async () => {
    await seedModel();
    renderPanel();

    await waitFor(() => screen.getByText("Cydonia-24B-v4.3-Q4_K_M"));
    expect(screen.getByText("24B")).toBeTruthy();
    expect(screen.getByText("Q4_K_M")).toBeTruthy();
  });

  it("opens the welcome modal when no model has been configured", async () => {
    renderPanel();

    await waitFor(() => screen.getByText("SERVER INITIALIZATION"));
  });

  it("opens settings from the header", async () => {
    await seedModel();
    const { goToSettings } = renderPanel();

    await userEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(goToSettings).toHaveBeenCalledTimes(1);
  });

  it("starts the llama.cpp server with the stored paths and creates an RTC offer", async () => {
    await seedModel();
    await UserSettingsService.saveSetting(
      UserSettingKey.VISION_MODEL_PATH,
      "C:\\models\\mmproj.gguf",
    );
    await UserSettingsService.saveSetting(
      UserSettingKey.ADDITIONAL_SERVER_CMD_ARGS,
      "--threads 8",
    );
    renderPanel();
    await waitFor(() => screen.getByText("Cydonia-24B-v4.3-Q4_K_M"));

    await userEvent.click(screen.getByRole("button", { name: "Start server" }));

    await waitFor(() =>
      expect(window.electronBridge.startServer).toHaveBeenCalledWith(
        "C:\\server\\llama-server.exe",
        "C:\\models\\Cydonia-24B-v4.3-Q4_K_M.gguf",
        "C:\\models\\mmproj.gguf",
        "--threads 8",
      ),
    );
    await waitFor(() => expect(statusLine()).toContain("Online"));
    await waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toContain("/rtc/get-answer");
  });

  it("skips starting a local server when no model path is configured", async () => {
    await UserSettingsService.saveSetting(
      UserSettingKey.LOCAL_SERVER_PATH,
      "C:\\server\\llama-server.exe",
    );
    renderPanel();
    await waitFor(() => screen.getByText("SERVER INITIALIZATION"));

    await userEvent.click(screen.getByRole("button", { name: "Start server" }));

    await waitFor(() =>
      screen.getByText(/Skipping LLM server start/, { exact: false }),
    );
    expect(window.electronBridge.startServer).not.toHaveBeenCalled();
  });

  it("stops the server and tears down the peer connection", async () => {
    await seedModel();
    renderPanel();
    await waitFor(() => screen.getByText("Cydonia-24B-v4.3-Q4_K_M"));

    await userEvent.click(screen.getByRole("button", { name: "Start server" }));
    const stop = await waitFor(() =>
      screen.getByRole("button", { name: "Stop server" }),
    );
    await waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));

    await userEvent.click(stop);

    await waitFor(() =>
      expect(window.electronBridge.stopServer).toHaveBeenCalledTimes(1),
    );
    expect(FakePeerConnection.instances[0].close).toHaveBeenCalled();
    await waitFor(() => expect(statusLine()).toContain("Offline"));
  });

  it("reports a failed start in the log", async () => {
    await seedModel();
    vi.mocked(window.electronBridge.startServer).mockRejectedValue(
      new Error("spawn ENOENT"),
    );
    renderPanel();
    await waitFor(() => screen.getByText("Cydonia-24B-v4.3-Q4_K_M"));

    await userEvent.click(screen.getByRole("button", { name: "Start server" }));

    await waitFor(() =>
      screen.getByText("Failed to start server: spawn ENOENT"),
    );
  });

  it("appends server stdout and stderr to the log viewer", async () => {
    await seedModel();
    const stdoutListeners: ((data: string) => void)[] = [];
    const stderrListeners: ((data: string) => void)[] = [];
    vi.mocked(window.electronBridge.onServerStdout).mockImplementation((cb) => {
      stdoutListeners.push(cb);
      return () => undefined;
    });
    vi.mocked(window.electronBridge.onServerStderr).mockImplementation((cb) => {
      stderrListeners.push(cb);
      return () => undefined;
    });

    renderPanel();
    await waitFor(() => expect(stdoutListeners).toHaveLength(1));

    stdoutListeners[0]("model loaded");
    stderrListeners[0]("warning: slow");

    await waitFor(() => screen.getByText("[stdout] model loaded"));
    await waitFor(() => screen.getByText("[stderr] warning: slow"));
  });

  it("collapses and expands the log viewer", async () => {
    await seedModel();
    renderPanel();

    const header = screen.getByText("SERVER LOGS");
    await userEvent.click(header);
    expect(
      screen.queryByText(/Click "START SERVER" to launch/),
    ).toBeNull();

    await userEvent.click(header);
    expect(screen.getByText(/Click "START SERVER" to launch/)).toBeTruthy();
  });

  it("shows the QR modal with the deep link secret after starting", async () => {
    await seedModel();
    await UserSettingsService.saveSetting(
      UserSettingKey.SERVER_SECRET_KEY,
      "secret1234567890",
    );
    renderPanel();
    await waitFor(() => screen.getByText("Cydonia-24B-v4.3-Q4_K_M"));

    await userEvent.click(screen.getByRole("button", { name: "Start server" }));

    const secret = await waitFor(() => screen.getByText("secret1234567890"), {
      timeout: 3000,
    });
    expect(secret).toBeTruthy();
    expect(screen.getByText("Your Server Secret")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Your Server Secret")).toBeNull();
  });

  it("reloads settings and alerts the user when returning from the settings page", async () => {
    await seedModel();
    const { view } = renderPanel();
    await waitFor(() => screen.getByText("Cydonia-24B-v4.3-Q4_K_M"));

    await UserSettingsService.saveSetting(
      UserSettingKey.MODEL_PATH,
      "/models/gemma-4-26B-Q8_0.gguf",
    );
    view.rerender(
      <LlmServerPanel goToSettings={vi.fn()} settingsRefreshCounter={1} />,
    );

    await waitFor(() => screen.getByText("gemma-4-26B-Q8_0"));
    expect(window.electronBridge.showAlert).toHaveBeenCalledWith(
      "Settings updated",
      expect.stringContaining("restart"),
    );
  });
});
