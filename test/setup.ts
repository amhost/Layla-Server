import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import type { ElectronAPI } from "../src/types/types";

export function createElectronBridgeMock(): ElectronAPI {
  return {
    getAppVersion: vi.fn(async () => "1.0.2"),
    openExternal: vi.fn(),
    openFileDialog: vi.fn(async () => null),
    startServer: vi.fn(async () => undefined),
    stopServer: vi.fn(async () => undefined),
    getDeviceName: vi.fn(async () => "test-pc"),
    onServerStdout: vi.fn(() => () => undefined),
    onServerStderr: vi.fn(() => () => undefined),
    showAlert: vi.fn(async () => undefined),
  };
}

window.electronBridge = createElectronBridgeMock();

// jsdom does not implement scrolling APIs used by the log viewer.
Element.prototype.scrollTo = vi.fn();

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.electronBridge = createElectronBridgeMock();
});
