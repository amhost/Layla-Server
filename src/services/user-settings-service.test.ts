import { beforeEach, describe, expect, it, vi } from "vitest";

type ServiceModule = typeof import("./user-settings-service");

/**
 * The service memoises whether defaults have been persisted in a static field,
 * so each test needs a freshly evaluated module.
 */
async function loadService(): Promise<ServiceModule> {
  vi.resetModules();
  return import("./user-settings-service");
}

const STORAGE_PREFIX = "user-setting:";

describe("USER_SETTING_DEFAULTS", () => {
  it("generates a 16 character alphanumeric secret key per module instance", async () => {
    const first = await loadService();
    const second = await loadService();

    const keyA = first.USER_SETTING_DEFAULTS[first.UserSettingKey.SERVER_SECRET_KEY];
    const keyB = second.USER_SETTING_DEFAULTS[second.UserSettingKey.SERVER_SECRET_KEY];

    expect(keyA).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(keyB).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(keyA).not.toBe(keyB);
  });

  it("defaults optional paths to null and the server url to the local llama-server endpoint", async () => {
    const { USER_SETTING_DEFAULTS: defaults, UserSettingKey } = await loadService();

    expect(defaults[UserSettingKey.MODEL_PATH]).toBeNull();
    expect(defaults[UserSettingKey.VISION_MODEL_PATH]).toBeNull();
    expect(defaults[UserSettingKey.ADDITIONAL_SERVER_CMD_ARGS]).toBeNull();
    expect(defaults[UserSettingKey.LOCAL_SERVER_URL]).toBe(
      "http://127.0.0.1:8080/v1/chat/completions",
    );
    expect(defaults[UserSettingKey.LOCAL_SERVER_PATH]).toBe(
      "./resources/server/llama-server.exe",
    );
  });
});

describe("UserSettingsService", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists non-null defaults on first read and leaves null defaults unstored", async () => {
    const { default: service, UserSettingKey, USER_SETTING_DEFAULTS } =
      await loadService();

    await service.getSetting(UserSettingKey.LOCAL_SERVER_URL);

    expect(
      localStorage.getItem(`${STORAGE_PREFIX}${UserSettingKey.SERVER_SECRET_KEY}`),
    ).toBe(
      JSON.stringify(USER_SETTING_DEFAULTS[UserSettingKey.SERVER_SECRET_KEY]),
    );
    expect(
      localStorage.getItem(`${STORAGE_PREFIX}${UserSettingKey.MODEL_PATH}`),
    ).toBeNull();
  });

  it("does not overwrite values that are already stored", async () => {
    const { default: service, UserSettingKey } = await loadService();

    localStorage.setItem(
      `${STORAGE_PREFIX}${UserSettingKey.SERVER_SECRET_KEY}`,
      JSON.stringify("preexisting-secret"),
    );

    expect(await service.getSetting(UserSettingKey.SERVER_SECRET_KEY)).toBe(
      "preexisting-secret",
    );
  });

  it("round-trips a saved setting", async () => {
    const { default: service, UserSettingKey } = await loadService();

    await service.saveSetting(UserSettingKey.MODEL_PATH, "C:\\models\\model.gguf");

    expect(await service.getSetting(UserSettingKey.MODEL_PATH)).toBe(
      "C:\\models\\model.gguf",
    );
  });

  it("treats saving null as removing the setting", async () => {
    const { default: service, UserSettingKey, USER_SETTING_DEFAULTS } =
      await loadService();

    await service.saveSetting(UserSettingKey.MODEL_PATH, "/models/a.gguf");
    await service.saveSetting(UserSettingKey.MODEL_PATH, null);

    expect(
      localStorage.getItem(`${STORAGE_PREFIX}${UserSettingKey.MODEL_PATH}`),
    ).toBeNull();
    expect(await service.getSetting(UserSettingKey.MODEL_PATH)).toBe(
      USER_SETTING_DEFAULTS[UserSettingKey.MODEL_PATH],
    );
  });

  it("removes a stored setting", async () => {
    const { default: service, UserSettingKey } = await loadService();

    await service.saveSetting(UserSettingKey.LOCAL_SERVER_URL, "http://host/v1");
    await service.removeSetting(UserSettingKey.LOCAL_SERVER_URL);

    expect(
      localStorage.getItem(`${STORAGE_PREFIX}${UserSettingKey.LOCAL_SERVER_URL}`),
    ).toBeNull();
  });

  it("falls back to the default when a stored value is not valid JSON", async () => {
    const { default: service, UserSettingKey, USER_SETTING_DEFAULTS } =
      await loadService();

    localStorage.setItem(
      `${STORAGE_PREFIX}${UserSettingKey.LOCAL_SERVER_URL}`,
      "{not-json",
    );

    expect(await service.getSetting(UserSettingKey.LOCAL_SERVER_URL)).toBe(
      USER_SETTING_DEFAULTS[UserSettingKey.LOCAL_SERVER_URL],
    );
  });

  it("reads several settings at once, mixing stored values and defaults", async () => {
    const { default: service, UserSettingKey, USER_SETTING_DEFAULTS } =
      await loadService();

    await service.saveSetting(UserSettingKey.MODEL_PATH, "/models/b.gguf");

    const settings = await service.getMultipleSettings([
      UserSettingKey.MODEL_PATH,
      UserSettingKey.VISION_MODEL_PATH,
      UserSettingKey.LOCAL_SERVER_URL,
    ]);

    expect(settings).toEqual({
      [UserSettingKey.MODEL_PATH]: "/models/b.gguf",
      [UserSettingKey.VISION_MODEL_PATH]:
        USER_SETTING_DEFAULTS[UserSettingKey.VISION_MODEL_PATH],
      [UserSettingKey.LOCAL_SERVER_URL]:
        USER_SETTING_DEFAULTS[UserSettingKey.LOCAL_SERVER_URL],
    });
  });

  it("falls back to defaults for corrupted values when reading several settings", async () => {
    const { default: service, UserSettingKey, USER_SETTING_DEFAULTS } =
      await loadService();

    localStorage.setItem(
      `${STORAGE_PREFIX}${UserSettingKey.ADDITIONAL_SERVER_CMD_ARGS}`,
      "[[[",
    );

    const settings = await service.getMultipleSettings([
      UserSettingKey.ADDITIONAL_SERVER_CMD_ARGS,
    ]);

    expect(settings[UserSettingKey.ADDITIONAL_SERVER_CMD_ARGS]).toBe(
      USER_SETTING_DEFAULTS[UserSettingKey.ADDITIONAL_SERVER_CMD_ARGS],
    );
  });
});
