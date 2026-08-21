import React, { useCallback, useEffect, useRef, useState } from "react";

import UserSettingsService, {
  UserSettingKey,
  USER_SETTING_DEFAULTS,
} from "../services/user-settings-service";

// ─── Recommended models ─────────────────────────────────────────────────────────

interface ModelInfo {
  category: string;
  name: string;
  size: string;
  image: string;
  author: string;
  downloadLink: string;
}

const RECOMMENDED_MODELS: ModelInfo[] = [
  {
    category: "General",
    name: "GPT OSS 20B",
    size: "11.6 GB",
    image: "./images/gpt.jpg",
    author: "OpenAI",
    downloadLink:
      "https://huggingface.co/unsloth/gpt-oss-20b-GGUF/resolve/main/gpt-oss-20b-Q4_K_M.gguf?download=true",
  },
  {
    category: "Assistant",
    name: "Gemma 4 26B A4B",
    size: "16.9 GB",
    image: "./images/gemma4.png",
    author: "Google",
    downloadLink:
      "https://huggingface.co/unsloth/gemma-4-26B-A4B-it-GGUF/resolve/main/gemma-4-26B-A4B-it-UD-Q4_K_M.gguf?download=true",
  },
  {
    category: "Friend",
    name: "Impish Bloodmoon 12B",
    size: "7.48 GB",
    image: "./images/Impish_Bloodmoon_12B.jpeg",
    author: "SicariusSicariiStuff",
    downloadLink:
      "https://huggingface.co/SicariusSicariiStuff/Impish_Bloodmoon_12B_GGUF/resolve/main/Impish_Bloodmoon-Q4_K_M.gguf?download=true",
  },
  {
    category: "Roleplay",
    name: "Cydonia-24B-v4.3",
    size: "25.1 GB",
    image: "./images/cydonia.png",
    author: "TheDrummer",
    downloadLink:
      "https://huggingface.co/TheDrummer/Cydonia-24B-v4.3-GGUF/resolve/main/Cydonia-24B-v4zg-Q8_0.gguf?download=true",
  },
];

// ─── External runtimes ──────────────────────────────────────────────────────────
//
// Connecting to an existing engine needs no settings of its own: it is the
// Server URL pointed somewhere else, with the Server Executable blanked so this
// app launches nothing and only proxies. These presets are UI sugar for filling
// in that URL — none of them are persisted.

interface ProviderPreset {
  id: string;
  name: string;
  glyph: string;
  baseUrl: string;
  hint: string;
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "lmstudio",
    name: "LM Studio",
    glyph: "◆",
    baseUrl: "http://127.0.0.1:1234",
    hint: "Developer tab → Start Server",
  },
  {
    id: "ollama",
    name: "Ollama",
    glyph: "◍",
    baseUrl: "http://127.0.0.1:11434",
    hint: "Runs in the background by default",
  },
  {
    id: "llama-server",
    name: "llama.cpp",
    glyph: "▲",
    baseUrl: "http://127.0.0.1:8080",
    hint: "A llama-server you started yourself",
  },
  {
    id: "custom",
    name: "Custom",
    glyph: "⌁",
    baseUrl: "http://127.0.0.1:8080",
    hint: "Any OpenAI-compatible endpoint",
  },
];

/**
 * Reduce whatever the user typed to a bare origin so we can append our own
 * endpoint path. Mirrors normaliseBaseUrl() in main.ts — people paste the full
 * `/v1/chat/completions` URL as often as they paste the host.
 */
function normaliseBaseUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/v1\/chat\/completions$/, "")
    .replace(/\/v1$/, "");
}

function chatCompletionsUrl(baseUrl: string): string {
  return `${normaliseBaseUrl(baseUrl)}/v1/chat/completions`;
}

function getFilename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

type Mode = "local" | "external";
type ProbeState = "idle" | "checking" | "connected" | "error";

// ─── Component ──────────────────────────────────────────────────────────────────

interface WelcomeModalProps {
  visible: boolean;
  /** Show a dismiss affordance. Off during first-run, where there is nothing to go back to. */
  dismissible?: boolean;
  /** Called after the choice is persisted (`saved`) or the modal was dismissed unchanged. */
  onClose: (saved: boolean) => void;
}

export const WelcomeModal: React.FC<WelcomeModalProps> = ({
  visible,
  dismissible = false,
  onClose,
}) => {
  const [mode, setMode] = useState<Mode>("local");

  // ── Local (GGUF) ──
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // ── External instance ──
  const [provider, setProvider] = useState<ProviderPreset | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [probeState, setProbeState] = useState<ProbeState>("idle");
  const [probeError, setProbeError] = useState<string | null>(null);
  const [modelCount, setModelCount] = useState(0);

  const [saving, setSaving] = useState(false);

  // Only the newest probe may write state: switching provider while a request
  // to the previous one is still in flight would otherwise show its result.
  const probeSeqRef = useRef(0);

  // ── Restore the current configuration when the modal is (re)opened ──
  useEffect(() => {
    if (!visible) return;

    let cancelled = false;
    (async () => {
      const saved = await UserSettingsService.getMultipleSettings([
        UserSettingKey.MODEL_PATH,
        UserSettingKey.LOCAL_SERVER_PATH,
        UserSettingKey.LOCAL_SERVER_URL,
      ]);
      if (cancelled) return;

      setSelectedFile(saved[UserSettingKey.MODEL_PATH] || null);

      // An empty Server Executable is what "proxy to something already running"
      // looks like in the saved settings — there is no separate mode flag.
      const isExternal = !saved[UserSettingKey.LOCAL_SERVER_PATH]?.trim();
      const url = normaliseBaseUrl(saved[UserSettingKey.LOCAL_SERVER_URL] || "");

      if (isExternal) {
        setMode("external");
        setBaseUrl(url);
        setProvider(
          PROVIDER_PRESETS.find((p) => p.baseUrl === url) ??
            PROVIDER_PRESETS.find((p) => p.id === "custom")!,
        );
      } else {
        // Reopening after a previous visit to the external tab must not leave
        // its stale connection state on screen.
        setMode("local");
        setProvider(null);
        setBaseUrl("");
        setModelCount(0);
        setProbeState("idle");
        setProbeError(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible]);

  // ── Probing ──
  // Purely a reachability check, so the user is told now rather than on the
  // first prompt from their phone. Whichever model the engine already has
  // loaded is the one that answers — we neither ask for it nor override it.

  const probe = useCallback(async (url: string) => {
    const target = normaliseBaseUrl(url);
    if (!target) {
      setProbeState("idle");
      return;
    }

    const seq = ++probeSeqRef.current;
    setProbeState("checking");
    setProbeError(null);

    try {
      const result = await window.electronBridge.probeBackend(target);
      if (seq !== probeSeqRef.current) return;

      if (result.ok) {
        setProbeState("connected");
        setModelCount(result.models.length);
      } else {
        setProbeState("error");
        setProbeError(result.error ?? "No server responded");
        setModelCount(0);
      }
    } catch (err: any) {
      if (seq !== probeSeqRef.current) return;
      setProbeState("error");
      setProbeError(err?.message ?? String(err));
      setModelCount(0);
    }
  }, []);

  // Re-probe as the URL settles, so picking a preset or editing the host
  // updates the status pill without the user hunting for a button.
  useEffect(() => {
    if (!visible || mode !== "external" || !baseUrl.trim()) return;

    const timer = setTimeout(() => probe(baseUrl), 400);
    return () => clearTimeout(timer);
  }, [visible, mode, baseUrl, probe]);

  const handleSelectProvider = (preset: ProviderPreset) => {
    setProvider(preset);
    setModelCount(0);
    setProbeState("idle");
    setProbeError(null);
    setBaseUrl(preset.baseUrl);
  };

  // ── Actions ──

  const handleDownload = (url: string) => {
    try {
      window.electronBridge.openExternal(url);
    } catch (error) {
      console.error("Failed to open external link:", error);
    }
  };

  const handlePickFile = async () => {
    const filePath = await window.electronBridge.openFileDialog();
    if (!filePath) return;
    setSelectedFile(filePath);
  };

  const canStart =
    mode === "local" ? !!selectedFile : probeState === "connected";

  const handleStart = async () => {
    if (!canStart || saving) return;
    setSaving(true);

    try {
      if (mode === "local") {
        await UserSettingsService.saveSetting(
          UserSettingKey.MODEL_PATH,
          selectedFile,
        );
        // Coming back from an external engine, both of these still point at it.
        await UserSettingsService.saveSetting(
          UserSettingKey.LOCAL_SERVER_PATH,
          USER_SETTING_DEFAULTS[UserSettingKey.LOCAL_SERVER_PATH],
        );
        await UserSettingsService.saveSetting(
          UserSettingKey.LOCAL_SERVER_URL,
          USER_SETTING_DEFAULTS[UserSettingKey.LOCAL_SERVER_URL],
        );
      } else {
        await UserSettingsService.saveSetting(
          UserSettingKey.LOCAL_SERVER_URL,
          chatCompletionsUrl(baseUrl),
        );
        // Blanking the executable is the whole switch: with nothing to launch,
        // starting the server becomes a pass-through to the URL above.
        await UserSettingsService.saveSetting(
          UserSettingKey.LOCAL_SERVER_PATH,
          "",
        );
      }

      onClose(true);
    } catch (error) {
      console.error("Failed to save server configuration:", error);
    } finally {
      setSaving(false);
    }
  };

  if (!visible) return null;

  const footerHint =
    mode === "local"
      ? selectedFile
        ? getFilename(selectedFile)
        : "Select a GGUF file to continue"
      : probeState === "connected"
        ? chatCompletionsUrl(baseUrl)
        : "Connect to a running server to continue";

  return (
    <>
      <div className="wm-overlay">
        <div className="wm-modal">
          {/* ── Header ── */}
          <header className="wm-header">
            <div>
              <h1 className="wm-title">Set up your server</h1>
              <p className="wm-subtitle">
                Choose where Layla should run inference.
              </p>
            </div>
            {dismissible && (
              <button
                className="wm-dismiss"
                onClick={() => onClose(false)}
                aria-label="Close"
              >
                ✕
              </button>
            )}
          </header>

          {/* ── Mode switch ── */}
          <div className="wm-segmented" role="tablist">
            <button
              role="tab"
              aria-selected={mode === "local"}
              className={`wm-segment${mode === "local" ? " wm-segment--active" : ""}`}
              onClick={() => setMode("local")}
            >
              <span className="wm-segment-label">Local model</span>
              <span className="wm-segment-sub">Run a GGUF here</span>
            </button>
            <button
              role="tab"
              aria-selected={mode === "external"}
              className={`wm-segment${mode === "external" ? " wm-segment--active" : ""}`}
              onClick={() => setMode("external")}
            >
              <span className="wm-segment-label">Existing server</span>
              <span className="wm-segment-sub">LM Studio, Ollama…</span>
            </button>
          </div>

          {/* ── Body ── */}
          <div className="wm-body">
            {mode === "local" ? (
              <>
                <Section
                  step="1"
                  title="Download a model"
                  subtitle="Skip this if you already have a GGUF on disk."
                >
                  <div className="wm-model-list">
                    {RECOMMENDED_MODELS.map((model) => (
                      <div key={model.name} className="wm-model-row">
                        <img
                          src={model.image}
                          alt=""
                          className="wm-model-thumb"
                        />
                        <div className="wm-model-meta">
                          <div className="wm-model-name" title={model.name}>
                            {model.name}
                          </div>
                          <div className="wm-model-detail">
                            {model.author} · {model.size}
                          </div>
                        </div>
                        <span className="wm-tag">{model.category}</span>
                        <button
                          className="wm-btn wm-btn--outline"
                          onClick={() => handleDownload(model.downloadLink)}
                        >
                          Download
                        </button>
                      </div>
                    ))}
                  </div>
                </Section>

                <Section
                  step="2"
                  title="Select your model file"
                  subtitle="Point Layla at the GGUF you want to serve."
                >
                  <button
                    className={`wm-picker${selectedFile ? " wm-picker--filled" : ""}`}
                    onClick={handlePickFile}
                  >
                    <span className="wm-picker-icon">
                      {selectedFile ? "✓" : "+"}
                    </span>
                    <span className="wm-picker-body">
                      <span className="wm-picker-title">
                        {selectedFile
                          ? getFilename(selectedFile)
                          : "Browse local files"}
                      </span>
                      <span className="wm-picker-path">
                        {selectedFile ?? "GGUF · any quantisation"}
                      </span>
                    </span>
                    <span className="wm-picker-action">
                      {selectedFile ? "Change" : "Browse"}
                    </span>
                  </button>
                </Section>
              </>
            ) : (
              <>
                <Section
                  step="1"
                  title="Pick your runtime"
                  subtitle="Layla launches nothing here — start the engine yourself, with a model already loaded in it."
                >
                  <div className="wm-provider-grid">
                    {PROVIDER_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        className={`wm-provider${provider?.id === preset.id ? " wm-provider--active" : ""}`}
                        onClick={() => handleSelectProvider(preset)}
                      >
                        <span className="wm-provider-glyph">
                          {preset.glyph}
                        </span>
                        <span className="wm-provider-name">{preset.name}</span>
                        <span className="wm-provider-hint">{preset.hint}</span>
                      </button>
                    ))}
                  </div>
                </Section>

                {provider && (
                  <Section
                    step="2"
                    title="Confirm the endpoint"
                    subtitle="Requests from your phone are passed straight through to this address."
                  >
                    <div className="wm-field-row">
                      <input
                        className="wm-input"
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        placeholder="http://127.0.0.1:8080"
                        spellCheck={false}
                        autoComplete="off"
                      />
                      <button
                        className="wm-btn wm-btn--outline"
                        onClick={() => probe(baseUrl)}
                        disabled={probeState === "checking"}
                      >
                        {probeState === "checking" ? "Checking…" : "Recheck"}
                      </button>
                    </div>

                    <StatusPill
                      state={probeState}
                      error={probeError}
                      modelCount={modelCount}
                    />

                    {probeState === "error" && (
                      <p className="wm-help">
                        Start {provider.name} first, then press Recheck.
                        {provider.id === "lmstudio" &&
                          " In LM Studio, the local server lives under the Developer tab."}
                        {provider.id === "ollama" &&
                          " Ollama serves on port 11434 once `ollama serve` is running."}
                      </p>
                    )}

                    {probeState === "connected" && (
                      <p className="wm-help">
                        Layla will send requests to{" "}
                        <code className="wm-code">
                          {chatCompletionsUrl(baseUrl)}
                        </code>
                        , answered by whichever model {provider.name} has
                        loaded.
                      </p>
                    )}
                  </Section>
                )}
              </>
            )}
          </div>

          {/* ── Footer ── */}
          <footer className="wm-footer">
            <span className="wm-footer-hint" title={footerHint}>
              {footerHint}
            </span>
            <button
              className="wm-btn wm-btn--primary"
              onClick={handleStart}
              disabled={!canStart || saving}
            >
              {saving ? "Saving…" : "Continue"}
            </button>
          </footer>
        </div>
      </div>
      <style>{cssStyles}</style>
    </>
  );
};

// ─── Small pieces ───────────────────────────────────────────────────────────────

const Section: React.FC<{
  step: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}> = ({ step, title, subtitle, children }) => (
  <section className="wm-section">
    <div className="wm-section-head">
      <span className="wm-step">{step}</span>
      <div>
        <div className="wm-section-title">{title}</div>
        {subtitle && <div className="wm-section-sub">{subtitle}</div>}
      </div>
    </div>
    {children}
  </section>
);

const StatusPill: React.FC<{
  state: ProbeState;
  error: string | null;
  modelCount: number;
}> = ({ state, error, modelCount }) => {
  if (state === "idle") return null;

  const label =
    state === "checking"
      ? "Looking for a server…"
      : state === "connected"
        ? modelCount > 0
          ? `Connected · ${modelCount} model${modelCount === 1 ? "" : "s"} available`
          : "Connected"
        : `Not reachable — ${error ?? "no response"}`;

  return (
    <div className={`wm-status wm-status--${state}`}>
      <span className="wm-status-dot" />
      <span className="wm-status-text">{label}</span>
    </div>
  );
};

// ─── CSS ────────────────────────────────────────────────────────────────────────

const cssStyles = `
.wm-overlay {
  --wm-primary: #47a6ff;
  --wm-primary-dim: rgba(71, 166, 255, 0.12);
  --wm-primary-border: rgba(71, 166, 255, 0.30);
  --wm-bg: #1c1c1c;
  --wm-card: #222222;
  --wm-card-hover: #272727;
  --wm-input: #2a2a2a;
  --wm-border: #343434;
  --wm-border-light: #3e3e3e;
  --wm-text: #e8e8e8;
  --wm-secondary: #999999;
  --wm-dim: #888888;
  --wm-success: #34d399;
  --wm-danger: #ff6347;

  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(6px);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  animation: wm-fade 0.18s ease-out;
}

@keyframes wm-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.wm-modal {
  width: 100%;
  max-width: 660px;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--wm-bg);
  border: 1px solid var(--wm-border);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
  animation: wm-rise 0.22s cubic-bezier(0.2, 0.8, 0.3, 1);
}

@keyframes wm-rise {
  from { opacity: 0; transform: translateY(12px) scale(0.985); }
  to   { opacity: 1; transform: none; }
}

/* ── Header ── */
.wm-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 26px 24px 18px;
  flex-shrink: 0;
}
.wm-title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.4px;
  color: var(--wm-text);
}
.wm-subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--wm-dim);
}
.wm-dismiss {
  background: none;
  border: none;
  color: var(--wm-dim);
  font-size: 15px;
  line-height: 1;
  padding: 6px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  flex-shrink: 0;
}
.wm-dismiss:hover {
  background: var(--wm-card);
  color: var(--wm-text);
}

/* ── Segmented control ── */
.wm-segmented {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin: 0 24px 4px;
  padding: 4px;
  background: var(--wm-card);
  border: 1px solid var(--wm-border);
  border-radius: 12px;
  flex-shrink: 0;
}
.wm-segment {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
  padding: 10px 14px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.wm-segment:hover {
  background: var(--wm-card-hover);
}
.wm-segment--active {
  background: var(--wm-primary-dim);
  border-color: var(--wm-primary-border);
}
.wm-segment-label {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--wm-secondary);
}
.wm-segment--active .wm-segment-label {
  color: var(--wm-primary);
}
.wm-segment-sub {
  font-size: 11.5px;
  color: var(--wm-dim);
}

/* ── Body ── */
.wm-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 24px 4px;
}
.wm-body::-webkit-scrollbar {
  width: 6px;
}
.wm-body::-webkit-scrollbar-track {
  background: transparent;
}
.wm-body::-webkit-scrollbar-thumb {
  background: var(--wm-border);
  border-radius: 3px;
}
.wm-body::-webkit-scrollbar-thumb:hover {
  background: var(--wm-border-light);
}

/* ── Section ── */
.wm-section {
  margin-bottom: 26px;
}
.wm-section-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 12px;
}
.wm-step {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  margin-top: 1px;
  border-radius: 6px;
  background: var(--wm-primary-dim);
  border: 1px solid var(--wm-primary-border);
  color: var(--wm-primary);
  font-size: 11px;
  font-weight: 700;
}
.wm-section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--wm-text);
}
.wm-section-sub {
  margin-top: 2px;
  font-size: 12px;
  color: var(--wm-secondary);
  line-height: 17px;
}

/* ── Recommended model list ── */
.wm-model-list {
  background: var(--wm-card);
  border: 1px solid var(--wm-border);
  border-radius: 12px;
  overflow: hidden;
}
.wm-model-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  transition: background 0.15s ease;
}
.wm-model-row:hover {
  background: var(--wm-card-hover);
}
.wm-model-row + .wm-model-row {
  border-top: 1px solid var(--wm-border);
}
.wm-model-thumb {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--wm-input);
}
.wm-model-meta {
  flex: 1;
  min-width: 0;
}
.wm-model-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--wm-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wm-model-detail {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--wm-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wm-tag {
  flex-shrink: 0;
  padding: 3px 7px;
  border-radius: 5px;
  background: rgba(71, 166, 255, 0.08);
  color: var(--wm-primary);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  user-select: none;
}

/* ── File picker ── */
.wm-picker {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 16px;
  border-radius: 12px;
  border: 1px dashed var(--wm-border-light);
  background: var(--wm-card);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.wm-picker:hover {
  border-color: var(--wm-primary-border);
  background: var(--wm-card-hover);
}
.wm-picker--filled {
  border-style: solid;
  border-color: rgba(52, 211, 153, 0.35);
}
.wm-picker-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: 9px;
  background: var(--wm-input);
  color: var(--wm-primary);
  font-size: 17px;
  font-weight: 500;
}
.wm-picker--filled .wm-picker-icon {
  background: rgba(52, 211, 153, 0.12);
  color: var(--wm-success);
}
.wm-picker-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.wm-picker-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--wm-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wm-picker-path {
  font-size: 11.5px;
  color: var(--wm-dim);
  font-family: Consolas, 'Courier New', monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}
.wm-picker-action {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--wm-primary);
}

/* ── Provider grid ── */
.wm-provider-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
}
.wm-provider {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 14px;
  border-radius: 12px;
  border: 1px solid var(--wm-border);
  background: var(--wm-card);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.wm-provider:hover {
  background: var(--wm-card-hover);
  border-color: var(--wm-border-light);
}
.wm-provider--active {
  background: var(--wm-primary-dim);
  border-color: var(--wm-primary-border);
}
.wm-provider-glyph {
  font-size: 15px;
  line-height: 1;
  color: var(--wm-dim);
  margin-bottom: 4px;
}
.wm-provider--active .wm-provider-glyph {
  color: var(--wm-primary);
}
.wm-provider-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--wm-text);
}
.wm-provider-hint {
  font-size: 11px;
  color: var(--wm-dim);
  line-height: 15px;
}

/* ── Inputs ── */
.wm-field-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.wm-input {
  flex: 1;
  min-width: 0;
  width: 100%;
  padding: 10px 14px;
  border-radius: 9px;
  border: 1px solid var(--wm-border);
  background: var(--wm-input);
  color: var(--wm-text);
  font-size: 13px;
  font-family: Consolas, 'Courier New', monospace;
  outline: none;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.wm-input::placeholder {
  color: var(--wm-dim);
}
.wm-input:focus {
  border-color: var(--wm-primary);
  background: rgba(71, 166, 255, 0.04);
}
/* ── Status pill ── */
.wm-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding: 7px 12px;
  border-radius: 8px;
  border: 1px solid var(--wm-border);
  background: var(--wm-card);
  max-width: 100%;
}
.wm-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--wm-dim);
}
.wm-status-text {
  font-size: 12px;
  color: var(--wm-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wm-status--checking .wm-status-dot {
  background: var(--wm-primary);
  animation: wm-pulse 1.2s ease-in-out infinite;
}
.wm-status--connected {
  border-color: rgba(52, 211, 153, 0.3);
  background: rgba(52, 211, 153, 0.08);
}
.wm-status--connected .wm-status-dot { background: var(--wm-success); }
.wm-status--connected .wm-status-text { color: var(--wm-success); }
.wm-status--error {
  border-color: rgba(255, 99, 71, 0.3);
  background: rgba(255, 99, 71, 0.08);
}
.wm-status--error .wm-status-dot { background: var(--wm-danger); }
.wm-status--error .wm-status-text { color: var(--wm-danger); }

@keyframes wm-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.3; }
}

.wm-help {
  margin: 10px 0 0;
  font-size: 11.5px;
  line-height: 17px;
  color: var(--wm-dim);
}
.wm-code {
  font-family: Consolas, 'Courier New', monospace;
  font-size: 11px;
  color: var(--wm-secondary);
  background: var(--wm-input);
  border-radius: 4px;
  padding: 1px 5px;
}

/* ── Buttons ── */
.wm-btn {
  flex-shrink: 0;
  padding: 9px 16px;
  border-radius: 9px;
  border: 1px solid transparent;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: transform 0.1s ease, opacity 0.15s ease, background 0.15s ease;
}
.wm-btn:active:not(:disabled) {
  transform: scale(0.96);
}
.wm-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.wm-btn--outline {
  background: transparent;
  border-color: var(--wm-primary-border);
  color: var(--wm-primary);
}
.wm-btn--outline:hover:not(:disabled) {
  background: var(--wm-primary-dim);
}
.wm-btn--primary {
  background: var(--wm-primary);
  color: #05070a;
  font-weight: 700;
  padding: 10px 26px;
}
.wm-btn--primary:hover:not(:disabled) {
  opacity: 0.9;
}

/* ── Footer ── */
.wm-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 24px;
  border-top: 1px solid var(--wm-border);
  background: var(--wm-card);
  flex-shrink: 0;
}
.wm-footer-hint {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--wm-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
`;
