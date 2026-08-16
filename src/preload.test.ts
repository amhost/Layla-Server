import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ElectronAPI } from "./types/types";

const exposeInMainWorld = vi.fn();
const invoke = vi.fn(async (..._args: unknown[]) => undefined);
const send = vi.fn((..._args: unknown[]) => undefined);
const on = vi.fn((..._args: unknown[]) => undefined);
const removeListener = vi.fn((..._args: unknown[]) => undefined);

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, api: unknown) =>
      exposeInMainWorld(key, api),
  },
  ipcRenderer: {
    invoke: (...args: unknown[]) => invoke(...args),
    send: (...args: unknown[]) => send(...args),
    on: (...args: unknown[]) => on(...args),
    removeListener: (...args: unknown[]) => removeListener(...args),
  },
}));

async function loadPreload(): Promise<ElectronAPI> {
  vi.resetModules();
  exposeInMainWorld.mockClear();
  await import("./preload");
  expect(exposeInMainWorld).toHaveBeenCalledWith(
    "electronBridge",
    expect.any(Object),
  );
  return exposeInMainWorld.mock.calls[0][1] as ElectronAPI;
}

describe("preload bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps each bridge method onto its ipc channel", async () => {
    const bridge = await loadPreload();

    await bridge.getAppVersion();
    await bridge.getDeviceName();
    await bridge.openFileDialog();
    await bridge.stopServer();
    await bridge.startServer("srv.exe", "model.gguf", "mmproj.gguf", "--flag");
    await bridge.showAlert("Title", "Body");
    bridge.openExternal("https://layla-network.ai");

    expect(invoke.mock.calls.map((c) => c[0])).toEqual([
      "get-app-version",
      "device:name",
      "dialog:openFile",
      "server:stop",
      "server:start",
      "dialog:alert",
    ]);
    expect(invoke).toHaveBeenCalledWith(
      "server:start",
      "srv.exe",
      "model.gguf",
      "mmproj.gguf",
      "--flag",
    );
    expect(invoke).toHaveBeenCalledWith("dialog:alert", "Title", "Body");
    expect(send).toHaveBeenCalledWith(
      "open-external",
      "https://layla-network.ai",
    );
  });

  it("forwards stdout events to the callback and unsubscribes on cleanup", async () => {
    const bridge = await loadPreload();
    const callback = vi.fn();

    const cleanup = bridge.onServerStdout(callback);

    expect(on).toHaveBeenCalledWith("server:stdout", expect.any(Function));
    const listener = on.mock.calls[0][1] as (
      event: unknown,
      data: string,
    ) => void;
    listener({}, "loading model");
    expect(callback).toHaveBeenCalledWith("loading model");

    cleanup();
    expect(removeListener).toHaveBeenCalledWith("server:stdout", listener);
  });

  it("forwards stderr events to the callback and unsubscribes on cleanup", async () => {
    const bridge = await loadPreload();
    const callback = vi.fn();

    const cleanup = bridge.onServerStderr(callback);

    const listener = on.mock.calls.find(
      (c) => c[0] === "server:stderr",
    )?.[1] as (event: unknown, data: string) => void;
    listener({}, "oom");
    expect(callback).toHaveBeenCalledWith("oom");

    cleanup();
    expect(removeListener).toHaveBeenCalledWith("server:stderr", listener);
  });
});
