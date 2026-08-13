import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: unknown, ...args: any[]) => unknown;

const handlers = new Map<string, Handler>();
const listeners = new Map<string, Handler>();
const appEvents = new Map<string, () => void>();

const browserWindowInstances: FakeBrowserWindow[] = [];

class FakeBrowserWindow extends EventEmitter {
  static allWindows: FakeBrowserWindow[] = [];
  static getAllWindows = () => FakeBrowserWindow.allWindows;

  loadFile = vi.fn();
  webContents = { openDevTools: vi.fn(), send: vi.fn() };

  constructor(public options: unknown) {
    super();
    browserWindowInstances.push(this);
    FakeBrowserWindow.allWindows.push(this);
  }
}

const electronMock = {
  app: {
    isPackaged: false,
    getVersion: vi.fn(() => "1.0.2"),
    quit: vi.fn(),
    whenReady: vi.fn(async () => undefined),
    on: vi.fn((channel: string, cb: () => void) => appEvents.set(channel, cb)),
  },
  BrowserWindow: FakeBrowserWindow,
  ipcMain: {
    handle: vi.fn((channel: string, handler: Handler) =>
      handlers.set(channel, handler),
    ),
    on: vi.fn((channel: string, handler: Handler) =>
      listeners.set(channel, handler),
    ),
  },
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    showMessageBox: vi.fn(async () => ({ response: 0 })),
  },
  Menu: { setApplicationMenu: vi.fn() },
  shell: { openExternal: vi.fn() },
};

const spawn = vi.fn();
const exec = vi.fn();

vi.mock("electron", () => electronMock);
vi.mock("child_process", () => ({ spawn, exec, default: { spawn, exec } }));

class FakeChildProcess extends EventEmitter {
  pid = 4242;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn(() => true);
}

async function loadMain(platform: NodeJS.Platform = "win32") {
  Object.defineProperty(process, "platform", { value: platform });
  handlers.clear();
  listeners.clear();
  appEvents.clear();
  vi.resetModules();
  await import("./main");
  // let the app.whenReady().then(...) continuation run
  await Promise.resolve();
  await Promise.resolve();
}

/** Starts the server via the ipc handler, resolving once the child has spawned. */
async function startServer(
  args: [string, string, string, string] = [
    "llama-server.exe",
    "model.gguf",
    "",
    "",
  ],
) {
  const child = new FakeChildProcess();
  spawn.mockReturnValue(child);
  const promise = handlers.get("server:start")!({}, ...args) as Promise<string>;
  child.emit("spawn");
  return { child, result: await promise };
}

const realPlatform = process.platform;

beforeEach(() => {
  vi.clearAllMocks();
  FakeBrowserWindow.allWindows = [];
  browserWindowInstances.length = 0;
  electronMock.app.whenReady.mockResolvedValue(undefined);
});

afterEach(() => {
  Object.defineProperty(process, "platform", { value: realPlatform });
});

describe("main window", () => {
  it("creates a frameless-menu window and opens devtools when unpackaged", async () => {
    await loadMain();

    expect(electronMock.Menu.setApplicationMenu).toHaveBeenCalledWith(null);
    expect(browserWindowInstances).toHaveLength(1);
    expect(browserWindowInstances[0].loadFile).toHaveBeenCalledWith(
      expect.stringContaining("index.html"),
    );
    expect(browserWindowInstances[0].webContents.openDevTools).toHaveBeenCalled();
  });

  it("keeps devtools closed in a packaged build", async () => {
    electronMock.app.isPackaged = true;
    await loadMain();
    electronMock.app.isPackaged = false;

    expect(
      browserWindowInstances[0].webContents.openDevTools,
    ).not.toHaveBeenCalled();
  });

  it("recreates the window on activate only when none are open", async () => {
    await loadMain("darwin");

    FakeBrowserWindow.allWindows = [];
    appEvents.get("activate")!();
    expect(browserWindowInstances).toHaveLength(2);

    appEvents.get("activate")!();
    expect(browserWindowInstances).toHaveLength(2);
  });

  it("quits when all windows close on non-darwin platforms", async () => {
    await loadMain("win32");

    appEvents.get("window-all-closed")!();

    expect(electronMock.app.quit).toHaveBeenCalledTimes(1);
  });

  it("stays alive when all windows close on darwin", async () => {
    await loadMain("darwin");

    appEvents.get("window-all-closed")!();

    expect(electronMock.app.quit).not.toHaveBeenCalled();
  });
});

describe("simple ipc handlers", () => {
  beforeEach(async () => {
    await loadMain();
  });

  it("returns the app version and the device name", async () => {
    expect(await handlers.get("get-app-version")!({})).toBe("1.0.2");
    expect(typeof (await handlers.get("device:name")!({}))).toBe("string");
  });

  it("returns the chosen file path from the open dialog", async () => {
    electronMock.dialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ["/models/chosen.gguf"],
    } as never);

    expect(await handlers.get("dialog:openFile")!({})).toBe(
      "/models/chosen.gguf",
    );
  });

  it("returns null when the open dialog is cancelled or empty", async () => {
    electronMock.dialog.showOpenDialog.mockResolvedValue({
      canceled: true,
      filePaths: ["/ignored"],
    } as never);
    expect(await handlers.get("dialog:openFile")!({})).toBeNull();

    electronMock.dialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [],
    } as never);
    expect(await handlers.get("dialog:openFile")!({})).toBeNull();
  });

  it("opens external urls in the system browser", () => {
    listeners.get("open-external")!({}, "https://layla-network.ai");

    expect(electronMock.shell.openExternal).toHaveBeenCalledWith(
      "https://layla-network.ai",
    );
  });

  it("shows an informational alert box", async () => {
    await handlers.get("dialog:alert")!({}, "Saved", "All good");

    expect(electronMock.dialog.showMessageBox).toHaveBeenCalledWith({
      type: "info",
      title: "Saved",
      message: "All good",
      buttons: ["OK"],
    });
  });
});

describe("server:start", () => {
  beforeEach(async () => {
    await loadMain();
  });

  it("rejects when the server or model path is missing", async () => {
    await expect(
      handlers.get("server:start")!({}, "", "model.gguf", "", ""),
    ).rejects.toBe("Server path and model path are required");
    await expect(
      handlers.get("server:start")!({}, "srv.exe", "   ", "", ""),
    ).rejects.toBe("Server path and model path are required");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("spawns the server with the model, vision model and extra arguments", async () => {
    const { result } = await startServer([
      "llama-server.exe",
      "model.gguf",
      "mmproj.gguf",
      "--threads 8  --ctx-size 4096",
    ]);

    expect(spawn).toHaveBeenCalledWith(
      "llama-server.exe",
      [
        "--model",
        "model.gguf",
        "--mmproj",
        "mmproj.gguf",
        "--threads",
        "8",
        "--ctx-size",
        "4096",
      ],
      expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
    );
    expect(result).toBe("Server started with PID 4242");
  });

  it("omits the vision model argument when it is blank", async () => {
    await startServer(["llama-server.exe", "model.gguf", "  ", ""]);

    expect(spawn.mock.calls[0][1]).toEqual(["--model", "model.gguf"]);
  });

  it("forwards child stdout and stderr to the renderer", async () => {
    const { child } = await startServer();

    child.stdout.emit("data", Buffer.from("loading"));
    child.stderr.emit("data", Buffer.from("warn"));

    expect(browserWindowInstances[0].webContents.send).toHaveBeenCalledWith(
      "server:stdout",
      "loading",
    );
    expect(browserWindowInstances[0].webContents.send).toHaveBeenCalledWith(
      "server:stderr",
      "warn",
    );
  });

  it("refuses to start a second server while one is running", async () => {
    await startServer();

    expect(await handlers.get("server:start")!({}, "srv.exe", "m.gguf", "", "")).toBe(
      "Server is already running",
    );
  });

  it("rejects and clears state when the child fails to spawn", async () => {
    const child = new FakeChildProcess();
    spawn.mockReturnValue(child);

    const promise = handlers.get("server:start")!(
      {},
      "missing.exe",
      "model.gguf",
      "",
      "",
    );
    child.emit("error", new Error("ENOENT"));

    await expect(promise).rejects.toBe("Failed to start server: ENOENT");
    // state was cleared, so a subsequent start attempt spawns again
    const { result } = await startServer();
    expect(result).toBe("Server started with PID 4242");
  });

  it("clears the running server when the child exits", async () => {
    const { child } = await startServer();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    child.emit("exit", 0, null);

    expect(await handlers.get("server:stop")!({})).toBe("No server is running");
    log.mockRestore();
  });
});

describe("server:stop", () => {
  it("reports when no server is running", async () => {
    await loadMain();

    expect(await handlers.get("server:stop")!({})).toBe("No server is running");
  });

  it("kills the process tree with taskkill on windows", async () => {
    await loadMain("win32");
    await startServer();
    exec.mockImplementation((_cmd: string, cb: (e: Error | null) => void) =>
      cb(null),
    );

    expect(await handlers.get("server:stop")!({})).toBe("Server stopped");
    expect(exec.mock.calls[0][0]).toBe("taskkill /pid 4242 /T /F");
  });

  it("surfaces a taskkill failure", async () => {
    await loadMain("win32");
    await startServer();
    exec.mockImplementation((_cmd: string, cb: (e: Error) => void) =>
      cb(new Error("access denied")),
    );

    expect(await handlers.get("server:stop")!({})).toBe(
      "Failed to stop server: taskkill failed: access denied",
    );
  });

  it("sends SIGTERM on posix platforms", async () => {
    await loadMain("linux");
    const { child } = await startServer();

    expect(await handlers.get("server:stop")!({})).toBe("Server stopped");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(exec).not.toHaveBeenCalled();
  });

  it("force kills with SIGKILL when the process ignores SIGTERM", async () => {
    vi.useFakeTimers();
    await loadMain("linux");
    const { child } = await startServer();

    await handlers.get("server:stop")!({});
    vi.advanceTimersByTime(5000);

    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    vi.useRealTimers();
  });

  it("reports a failure when SIGTERM cannot be delivered", async () => {
    await loadMain("linux");
    const { child } = await startServer();
    child.kill.mockReturnValue(false);

    expect(await handlers.get("server:stop")!({})).toBe(
      "Failed to stop server: Failed to send SIGTERM",
    );
  });
});
