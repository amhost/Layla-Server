// 256-bit random authentication secret, hex-encoded
function generateSecretKey(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);

  return Array.from(
    bytes,
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export enum UserSettingKey {
  LOCAL_SERVER_URL = "local-server-url",
  MODEL_PATH = "model-path",
  VISION_MODEL_PATH = "vision-model-path",
  LOCAL_SERVER_PATH = "local-server-path",
  ADDITIONAL_SERVER_CMD_ARGS = "additional-server-cmd-args",
  SERVER_SECRET_KEY = "server-secret-key",
}

type UserSettingDefaults = {
  [UserSettingKey.LOCAL_SERVER_URL]: string;
  [UserSettingKey.MODEL_PATH]: string | null;
  [UserSettingKey.VISION_MODEL_PATH]: string | null;
  [UserSettingKey.LOCAL_SERVER_PATH]: string;
  [UserSettingKey.ADDITIONAL_SERVER_CMD_ARGS]: string | null;
  [UserSettingKey.SERVER_SECRET_KEY]: string;
};

export const USER_SETTING_DEFAULTS: {
  [K in UserSettingKey]: UserSettingDefaults[K];
} = {
  [UserSettingKey.LOCAL_SERVER_URL]:
    "http://127.0.0.1:8080/v1/chat/completions",
  [UserSettingKey.MODEL_PATH]: null,
  [UserSettingKey.VISION_MODEL_PATH]: null,
  [UserSettingKey.LOCAL_SERVER_PATH]:
    "./resources/server/llama-server.exe",
  [UserSettingKey.ADDITIONAL_SERVER_CMD_ARGS]: null,
  [UserSettingKey.SERVER_SECRET_KEY]: generateSecretKey(),
};

const STORAGE_PREFIX = "user-setting:";

class UserSettingsService {
  private static initialized = false;

  private static ensureDefaults(): void {
    if (UserSettingsService.initialized) return;

    // On first run, persist any defaults that are not already stored.
    // This preserves an existing secret and saves a secure random secret
    // only when no secret has previously been stored.
    for (const key of Object.values(UserSettingKey)) {
      if (localStorage.getItem(`${STORAGE_PREFIX}${key}`) === null) {
        const defaultValue = USER_SETTING_DEFAULTS[key];

        if (defaultValue !== null) {
          localStorage.setItem(
            `${STORAGE_PREFIX}${key}`,
            JSON.stringify(defaultValue),
          );
        }
      }
    }

    UserSettingsService.initialized = true;
  }

  static async removeSetting(key: UserSettingKey): Promise<void> {
    localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
  }

  static async saveSetting<K extends UserSettingKey>(
    key: K,
    value: UserSettingDefaults[K],
  ): Promise<void> {
    if (value === null) {
      await UserSettingsService.removeSetting(key);
      return;
    }

    localStorage.setItem(
      `${STORAGE_PREFIX}${key}`,
      JSON.stringify(value),
    );
  }

  static async getSetting<K extends UserSettingKey>(
    key: K,
  ): Promise<UserSettingDefaults[K]> {
    UserSettingsService.ensureDefaults();

    const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`);

    if (raw === null) {
      return USER_SETTING_DEFAULTS[key];
    }

    try {
      return JSON.parse(raw) as UserSettingDefaults[K];
    } catch {
      return USER_SETTING_DEFAULTS[key];
    }
  }

  static async getMultipleSettings<K extends UserSettingKey>(
    keys: K[],
  ): Promise<{ [key in K]: UserSettingDefaults[key] }> {
    UserSettingsService.ensureDefaults();

    const result: Partial<{
      [key in K]: UserSettingDefaults[key];
    }> = {};

    for (const key of keys) {
      const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`);

      if (raw === null) {
        result[key] = USER_SETTING_DEFAULTS[key];
        continue;
      }

      try {
        result[key] = JSON.parse(raw) as UserSettingDefaults[typeof key];
      } catch {
        result[key] = USER_SETTING_DEFAULTS[key];
      }
    }

    return result as {
      [key in K]: UserSettingDefaults[key];
    };
  }
}

export default UserSettingsService;