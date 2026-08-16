import { waitForEvent } from "./async";

export const WEBRTC_DATA_CHANNEL_LABEL = "layla-datachannel";

/** Maximum payload size of a single transport message. */
export const CHUNK_SIZE = 16_000;

export interface LaylaServerTransportMessage {
  sessionId: string;
  type: "start" | "chunk" | "end" | "cmd";
  payload: string;
}

/** Split a payload into a start / chunk… / end transport message sequence. */
export function wrapMessages(
  sessionId: string,
  fullPayload: string,
): LaylaServerTransportMessage[] {
  const messages: LaylaServerTransportMessage[] = [
    { sessionId, type: "start", payload: "" },
  ];
  for (let i = 0; i < fullPayload.length; i += CHUNK_SIZE) {
    messages.push({
      sessionId,
      type: "chunk",
      payload: fullPayload.slice(i, i + CHUNK_SIZE),
    });
  }
  messages.push({ sessionId, type: "end", payload: "" });
  return messages;
}

/** Close a data channel and peer connection, ignoring any teardown errors. */
export function closeRtcConnection(
  peerConnection: RTCPeerConnection | null | undefined,
  dataChannel: RTCDataChannel | null | undefined,
  onError?: (message: string) => void,
): void {
  try {
    dataChannel?.close();
  } catch (e: any) {
    onError?.(e.message);
  }
  try {
    peerConnection?.close();
  } catch (e: any) {
    onError?.(e.message);
  }
}

/** Send a transport message when the channel is open; reports send failures. */
export function sendTransportMessage(
  dataChannel: RTCDataChannel | null | undefined,
  message: LaylaServerTransportMessage,
  onError?: (message: string) => void,
): void {
  if (!dataChannel || dataChannel.readyState !== "open") return;
  try {
    dataChannel.send(JSON.stringify(message));
  } catch (e: any) {
    onError?.(e.message);
  }
}

/** Wait for a DataChannel to reach "open" state, with a timeout. */
export function waitForDataChannelOpen(
  dataChannel: RTCDataChannel,
  timeoutMs: number,
): Promise<boolean> {
  return waitForEvent(
    dataChannel,
    "open",
    timeoutMs,
    () => dataChannel.readyState === "open",
  );
}

/** Wait for ICE gathering to complete, with a timeout. */
export function waitForIceGatheringComplete(
  peerConnection: RTCPeerConnection,
  timeoutMs: number,
): Promise<boolean> {
  return waitForEvent(
    peerConnection,
    "icegatheringstatechange",
    timeoutMs,
    () => peerConnection.iceGatheringState === "complete",
  );
}
