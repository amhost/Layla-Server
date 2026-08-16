function generatePassword(length: number = 16): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const max = 256 - (256 % chars.length);
  let key = "";
  while (key.length < length) {
    for (const byte of globalThis.crypto.getRandomValues(new Uint8Array(length))) {
      if (byte < max) {
        key += chars[byte % chars.length];
        if (key.length === length) break;
      }
    }
  }
  return key;
}

export enum UserSettingKey {
  LOCAL_SERVER_URL = 'local-server-url',
  MODEL_PATH = 'model-path',
  VISION_MODEL_PATH = 'vision-model-path',
  LOCAL_SERVER_PATH = 'local-server-path',
  ADDITIONAL_SERVER_CMD_ARGS = 'additional-server-cmd-args',
  SERVER_SECRET_KEY = 'server-secret-key',
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
  [UserSettingKey.LOCAL_SERVER_URL]: 'http://127.0.0.1:8080/v1/chat/completions',
  [UserSettingKey.MODEL_PATH]: null,
  [UserSettingKey.VISION_MODEL_PATH]: null,
  [UserSettingKey.LOCAL_SERVER_PATH]: './resources/server/llama-server.exe',
  [UserSettingKey.ADDITIONAL_SERVER_CMD_ARGS]: null,
  [UserSettingKey.SERVER_SECRET_KEY]: generatePassword(),
};

const STORAGE_PREFIX = 'user-setting:';

const storageKey = (key: UserSettingKey): string => `${STORAGE_PREFIX}${key}`;

/** A setting's default as a string, with null collapsed to "" (for form state). */
export function settingDefaultAsString(key: UserSettingKey): string {
  return USER_SETTING_DEFAULTS[key] ?? '';
}

class UserSettingsService {
  private static initialized = false;

  /** Read a stored setting, falling back to its default when absent or corrupt. */
  private static readStored<K extends UserSettingKey>(
    key: K,
  ): UserSettingDefaults[K] {
    const raw = localStorage.getItem(storageKey(key));
    if (raw === null) {
      return USER_SETTING_DEFAULTS[key];
    }

    try {
      return JSON.parse(raw);
    } catch {
      return USER_SETTING_DEFAULTS[key];
    }
  }

  private static ensureDefaults() {
    if (UserSettingsService.initialized) return;

    // On first run, persist any defaults that aren't already stored
    // (this saves the randomly generated secret key)
    for (const key of Object.values(UserSettingKey)) {
      if (localStorage.getItem(storageKey(key)) === null) {
        const defaultValue = USER_SETTING_DEFAULTS[key as UserSettingKey];
        if (defaultValue !== null) {
          localStorage.setItem(storageKey(key), JSON.stringify(defaultValue));
        }
      }
    }

    UserSettingsService.initialized = true;
  }

  static async removeSetting(key: UserSettingKey): Promise<void> {
    localStorage.removeItem(storageKey(key));
  }

  static async saveSetting<K extends UserSettingKey>(
    key: K,
    value: UserSettingDefaults[K],
  ): Promise<void> {
    if (value === null) {
      await UserSettingsService.removeSetting(key);
    } else {
      localStorage.setItem(storageKey(key), JSON.stringify(value));
    }
  }

  static async getSetting<K extends UserSettingKey>(
    key: K,
  ): Promise<UserSettingDefaults[K]> {
    UserSettingsService.ensureDefaults();

    return UserSettingsService.readStored(key);
  }

  static async getMultipleSettings<K extends UserSettingKey>(
    keys: K[],
  ): Promise<{ [key in K]: UserSettingDefaults[key] }> {
    UserSettingsService.ensureDefaults();

    const result: Partial<{ [key in K]: UserSettingDefaults[key] }> = {};

    for (const key of keys) {
      result[key] = UserSettingsService.readStored(key);
    }

    return result as { [key in K]: UserSettingDefaults[key] };
  }

  /** Every setting as a string, with nulls collapsed to "" (for form state). */
  static async getAllSettingsAsStrings(): Promise<
    Record<UserSettingKey, string>
  > {
    UserSettingsService.ensureDefaults();

    const result = {} as Record<UserSettingKey, string>;

    for (const key of Object.values(UserSettingKey)) {
      result[key] = UserSettingsService.readStored(key) ?? '';
    }

    return result;
  }
}

export default UserSettingsService;
