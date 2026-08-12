import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHUNK_SIZE,
  extractTags,
  generateTimestamp,
  getFilenameFromPath,
  wrapMessages,
} from "./LLMServerPanel";

afterEach(() => {
  vi.useRealTimers();
});

describe("wrapMessages", () => {
  it("frames a small payload as start / single chunk / end", () => {
    expect(wrapMessages("session-1", "hello")).toEqual([
      { sessionId: "session-1", type: "start", payload: "" },
      { sessionId: "session-1", type: "chunk", payload: "hello" },
      { sessionId: "session-1", type: "end", payload: "" },
    ]);
  });

  it("splits a large payload into chunks of at most CHUNK_SIZE and preserves the content", () => {
    const payload = "x".repeat(CHUNK_SIZE * 2 + 7);

    const messages = wrapMessages("s", payload);
    const chunks = messages.filter((m) => m.type === "chunk");

    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.payload.length)).toEqual([
      CHUNK_SIZE,
      CHUNK_SIZE,
      7,
    ]);
    expect(chunks.map((c) => c.payload).join("")).toBe(payload);
    expect(messages[0].type).toBe("start");
    expect(messages[messages.length - 1].type).toBe("end");
  });

  it("emits no chunks for an empty payload", () => {
    expect(wrapMessages("s", "").map((m) => m.type)).toEqual(["start", "end"]);
  });
});

describe("getFilenameFromPath", () => {
  it("strips windows directories and the extension", () => {
    expect(getFilenameFromPath("C:\\models\\gpt-oss-20b-Q4_K_M.gguf")).toBe(
      "gpt-oss-20b-Q4_K_M",
    );
  });

  it("strips posix directories and the extension", () => {
    expect(getFilenameFromPath("/home/al/models/gemma-4-26B.gguf")).toBe(
      "gemma-4-26B",
    );
  });

  it("keeps every segment but the last of a dotted filename", () => {
    expect(getFilenameFromPath("/models/model.v2.final.gguf")).toBe(
      "model.v2.final",
    );
  });

  it("returns an empty string for a filename without an extension", () => {
    expect(getFilenameFromPath("/models/llama-server")).toBe("");
  });

  it("returns the input when the path ends in a separator", () => {
    expect(getFilenameFromPath("/models/")).toBe("/models/");
  });
});

describe("extractTags", () => {
  it("extracts an upper-cased parameter size tag", () => {
    expect(extractTags("gemma-4-26b-it")).toContain("26B");
  });

  it("extracts a quantisation tag", () => {
    expect(extractTags("Cydonia-24B-v4.3-q4_k_m")).toEqual(["24B", "Q4_K_M"]);
  });

  it("handles a decimal parameter size", () => {
    expect(extractTags("model-1.5B-Q8_0")).toEqual(["1.5B", "Q8_0"]);
  });

  it("returns no tags when nothing matches", () => {
    expect(extractTags("mystery-model")).toEqual([]);
  });

  it("deduplicates repeated tags", () => {
    expect(extractTags("q4_0_thing_Q4_0")).toEqual(["Q4_0_THING_Q4_0"]);
  });
});

describe("generateTimestamp", () => {
  it("formats the current time as 24 hour HH:MM:SS", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T13:45:56Z"));

    expect(generateTimestamp()).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("subtracts the given offset from the current time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T13:45:56Z"));

    const now = generateTimestamp();
    const oneHourAgo = generateTimestamp(3_600_000);

    expect(oneHourAgo).not.toBe(now);
    expect(
      Number(now.split(":")[0]) - Number(oneHourAgo.split(":")[0]),
    ).toBeCloseTo(1);
  });
});
