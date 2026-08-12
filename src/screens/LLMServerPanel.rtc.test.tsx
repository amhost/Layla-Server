import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LlmServerPanel from "./LLMServerPanel";
import UserSettingsService, {
  UserSettingKey,
} from "../services/user-settings-service";

vi.mock("qrcode", () => ({ toCanvas: vi.fn(), default: { toCanvas: vi.fn() } }));

const SECRET = "test-secret-0001";
const LOCAL_SERVER_URL = "http://127.0.0.1:8080/v1/chat/completions";
const ANSWER_SDP = "v=0 fake-answer";

class FakeDataChannel extends EventTarget {
  readyState: RTCDataChannelState = "connecting";
  label = "layla-datachannel";
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = "closed";
  });
}

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];
  connectionState: RTCPeerConnectionState = "new";
  iceConnectionState = "new";
  iceGatheringState = "complete";
  localDescription: { sdp: string } | null = null;
  dataChannel = new FakeDataChannel();
  onicecandidate: ((event: { candidate: unknown }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;

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

/** A request that never resolves, but rejects like fetch does when aborted. */
const parked = (signal?: AbortSignal) =>
  new Promise<Response>((_resolve, reject) => {
    signal?.addEventListener(
      "abort",
      () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
      { once: true },
    );
  });

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** A streaming response whose reader emits the given chunks, then completes. */
function streamResponse(chunks: string[]): Response {
  let index = 0;
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    body: {
      getReader: () => ({
        read: async () =>
          index < chunks.length
            ? {
                done: false,
                value: new TextEncoder().encode(chunks[index++]),
              }
            : { done: true, value: undefined },
      }),
    },
  } as unknown as Response;
}

/**
 * Routes signalling calls to `answers` (one response per poll, then parked) and
 * local inference calls to `localResponse`.
 */
function routedFetch(answers: (() => Promise<Response>)[], localResponse?: () => Promise<Response>) {
  let poll = 0;
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes("/rtc/get-answer")) {
      const next = answers[poll++];
      return next ? next() : parked(init?.signal ?? undefined);
    }
    return localResponse ? localResponse() : parked(init?.signal ?? undefined);
  });
}

async function startPanel() {
  render(<LlmServerPanel goToSettings={vi.fn()} settingsRefreshCounter={0} />);
  await waitFor(() => screen.getByText("gpt-oss-20b-Q4_K_M"));
  await userEvent.click(screen.getByRole("button", { name: "Start server" }));
  const pc = await waitFor(() => {
    expect(FakePeerConnection.instances).toHaveLength(1);
    return FakePeerConnection.instances[0];
  });
  return pc;
}

beforeEach(async () => {
  FakePeerConnection.instances = [];
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
  vi.stubGlobal(
    "RTCSessionDescription",
    class {
      constructor(public init: { type: string; sdp: string }) {}
    },
  );
  await UserSettingsService.saveSetting(
    UserSettingKey.MODEL_PATH,
    "/models/gpt-oss-20b-Q4_K_M.gguf",
  );
  await UserSettingsService.saveSetting(UserSettingKey.SERVER_SECRET_KEY, SECRET);
  await UserSettingsService.saveSetting(
    UserSettingKey.LOCAL_SERVER_URL,
    LOCAL_SERVER_URL,
  );
});

afterEach(async () => {
  // Stop the server so the signalling retry loop does not outlive the test.
  for (const stop of screen.queryAllByRole("button", { name: "Stop server" })) {
    await userEvent.click(stop);
  }
  await new Promise((resolve) => setTimeout(resolve, 1100));
  vi.unstubAllGlobals();
});

describe("LlmServerPanel signalling", () => {
  it("ignores an answer whose secret does not match", async () => {
    vi.stubGlobal(
      "fetch",
      routedFetch([async () => jsonResponse({ secret: "other", payload: ANSWER_SDP })]),
    );

    const pc = await startPanel();

    await waitFor(() =>
      screen.getByText("RTC answer secret mismatch: other, IGNORING"),
    );
    expect(pc.setRemoteDescription).not.toHaveBeenCalled();
  });

  it("ignores an answer with an empty payload", async () => {
    vi.stubGlobal(
      "fetch",
      routedFetch([async () => jsonResponse({ secret: SECRET, payload: "" })]),
    );

    await startPanel();

    await waitFor(() =>
      screen.getByText("RTC answer with empty payload, IGNORING"),
    );
  });

  it("logs a non-ok signalling response and keeps polling", async () => {
    vi.stubGlobal(
      "fetch",
      routedFetch([
        async () =>
          ({
            ok: false,
            status: 404,
            text: async () => "no answer",
          }) as unknown as Response,
      ]),
    );

    await startPanel();

    await waitFor(() =>
      screen.getByText("No answer yet; status: 404, response: no answer"),
    );
  });

  it("logs a signalling transport failure", async () => {
    vi.stubGlobal(
      "fetch",
      routedFetch([
        async () => {
          throw new Error("network down");
        },
      ]),
    );

    await startPanel();

    await waitFor(() => screen.getByText("Fetch error: network down"));
  });

  it("applies a matching answer and reports the open data channel", async () => {
    let pcRef: FakePeerConnection | null = null;
    vi.stubGlobal(
      "fetch",
      routedFetch([
        async () => {
          // the channel opens as soon as the remote answer is on its way
          const dc = FakePeerConnection.instances[0].dataChannel;
          dc.readyState = "open";
          return jsonResponse({ secret: SECRET, payload: ANSWER_SDP });
        },
      ]),
    );

    pcRef = await startPanel();

    await waitFor(() =>
      expect(pcRef!.setRemoteDescription).toHaveBeenCalledWith(
        expect.objectContaining({ init: { type: "answer", sdp: ANSWER_SDP } }),
      ),
    );
    await waitFor(() => screen.getByText(/Remote answer received/));
  });

  it("proxies a buffered request to the local server and streams chunks back", async () => {
    vi.stubGlobal(
      "fetch",
      routedFetch(
        [
          async () => {
            FakePeerConnection.instances[0].dataChannel.readyState = "open";
            return jsonResponse({ secret: SECRET, payload: ANSWER_SDP });
          },
        ],
        async () => streamResponse(['data: {"delta":"hi"}\n\n']),
      ),
    );

    const pc = await startPanel();
    await waitFor(() => screen.getByText(/Remote answer received/));

    const dc = pc.dataChannel;
    dc.onmessage!({ data: JSON.stringify({ sessionId: "s1", type: "start", payload: "" }) });
    dc.onmessage!({
      data: JSON.stringify({ sessionId: "s1", type: "chunk", payload: '{"model":"x"}' }),
    });
    dc.onmessage!({ data: JSON.stringify({ sessionId: "s1", type: "end", payload: "" }) });

    await waitFor(() => expect(dc.send).toHaveBeenCalled());
    const sent = dc.send.mock.calls.map(([raw]) => JSON.parse(raw as string));
    expect(sent.map((m) => m.type)).toEqual(["start", "chunk", "end"]);
    expect(sent[1]).toMatchObject({
      sessionId: "s1",
      payload: 'data: {"delta":"hi"}\n\n',
    });
    const localCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([url]) => String(url) === LOCAL_SERVER_URL);
    expect(localCall?.[1]).toMatchObject({
      method: "POST",
      body: '{"model":"x"}',
    });
    await waitFor(() => screen.getByText("Stream completed"));
  });

  it("logs an error when the local server response has no body", async () => {
    vi.stubGlobal(
      "fetch",
      routedFetch(
        [
          async () => {
            FakePeerConnection.instances[0].dataChannel.readyState = "open";
            return jsonResponse({ secret: SECRET, payload: ANSWER_SDP });
          },
        ],
        async () =>
          ({ ok: true, status: 200, statusText: "OK", body: null }) as unknown as Response,
      ),
    );

    const pc = await startPanel();
    await waitFor(() => screen.getByText(/Remote answer received/));

    pc.dataChannel.onmessage!({
      data: JSON.stringify({ sessionId: "s1", type: "end", payload: "" }),
    });

    await waitFor(() => screen.getByText("Response body is null"));
  });

  it("aborts an in-flight stream on a stop command", async () => {
    vi.stubGlobal(
      "fetch",
      routedFetch([
        async () => {
          FakePeerConnection.instances[0].dataChannel.readyState = "open";
          return jsonResponse({ secret: SECRET, payload: ANSWER_SDP });
        },
      ]),
    );

    const pc = await startPanel();
    await waitFor(() => screen.getByText(/Remote answer received/));

    pc.dataChannel.onmessage!({
      data: JSON.stringify({ sessionId: "s1", type: "cmd", payload: "stop" }),
    });

    await waitFor(() => screen.getByText("Stream aborted by command"));
  });

  it("warns about an unknown command", async () => {
    vi.stubGlobal(
      "fetch",
      routedFetch([
        async () => {
          FakePeerConnection.instances[0].dataChannel.readyState = "open";
          return jsonResponse({ secret: SECRET, payload: ANSWER_SDP });
        },
      ]),
    );

    const pc = await startPanel();
    await waitFor(() => screen.getByText(/Remote answer received/));

    pc.dataChannel.onmessage!({
      data: JSON.stringify({ sessionId: "s1", type: "cmd", payload: "reboot" }),
    });

    await waitFor(() => screen.getByText("Unknown command: reboot"));
  });

  it("ignores binary data channel messages and malformed json", async () => {
    vi.stubGlobal("fetch", routedFetch([]));

    const pc = await startPanel();
    const dc = pc.dataChannel;

    dc.onmessage!({ data: new ArrayBuffer(8) });
    await waitFor(() =>
      screen.getByText(
        "Received unexpected binary message (8 bytes), ignoring",
      ),
    );

    dc.onmessage!({ data: "not-json" });
    await waitFor(() => screen.getByText(/Failed to handle RTC message/));
  });

  it("reports connection state changes and retries after a failure", async () => {
    vi.stubGlobal("fetch", routedFetch([]));

    const pc = await startPanel();

    pc.connectionState = "connected";
    pc.onconnectionstatechange!();
    await waitFor(() => screen.getByText("RTC state → connected"));

    pc.iceConnectionState = "checking";
    pc.oniceconnectionstatechange!();
    await waitFor(() => screen.getByText("ICE connection state → checking"));

    pc.onicecandidate!({ candidate: { candidate: "candidate:1 udp 127.0.0.1" } });
    await waitFor(() => screen.getByText(/ICE candidate gathered/));

    pc.connectionState = "failed";
    pc.onconnectionstatechange!();

    // the aborted poll makes the outer loop tear the peer down and try again
    await waitFor(() => expect(pc.close).toHaveBeenCalled());
  });

  it("logs when the offer has no local description and retries", async () => {
    vi.stubGlobal("fetch", routedFetch([]));
    // Only the first offer lacks an SDP, so the retry settles into polling
    // instead of spinning (the retry path skips the inter-attempt sleep).
    let attempts = 0;
    const noSdp = class extends FakePeerConnection {
      setLocalDescription = async () => {
        this.localDescription = attempts++ === 0 ? null : { sdp: "v=0 offer" };
      };
    };
    vi.stubGlobal("RTCPeerConnection", noSdp);

    render(<LlmServerPanel goToSettings={vi.fn()} settingsRefreshCounter={0} />);
    await waitFor(() => screen.getByText("gpt-oss-20b-Q4_K_M"));
    await userEvent.click(screen.getByRole("button", { name: "Start server" }));

    await waitFor(() =>
      screen.getByText("Failed to create RTC offer: SDP is null"),
    );
  });

  it("creates a fresh offer after the data channel closes", async () => {
    vi.stubGlobal("fetch", routedFetch([]));

    const pc = await startPanel();
    pc.dataChannel.onclose!();

    await waitFor(() => screen.getByText("DataChannel CLOSED"));
    await waitFor(
      () => expect(FakePeerConnection.instances.length).toBeGreaterThan(1),
      { timeout: 4000 },
    );
    expect(pc.close).toHaveBeenCalled();
  });
});
