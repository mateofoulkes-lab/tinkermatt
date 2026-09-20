// v0.8.5 handshake compatibility shim.
//
// The original MCP browser bridge was introduced in v0.5.7 and still sends
// appVersion: "0.5.7" from its private connectMcp() closure. Newer UI layers
// cannot reach that closure directly, so patch WebSocket.send before v057 loads
// and rewrite only TinkerMatt editor hello packets.

declare global {
  interface Window {
    __tmAppVersion?: string;
  }
}

window.__tmAppVersion = "0.8.5";

const originalSend = WebSocket.prototype.send;
WebSocket.prototype.send = function tmVersionAwareSend(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
  if (typeof data === "string") {
    try {
      const message = JSON.parse(data);
      if (message?.type === "hello" && message?.role === "editor") {
        message.appVersion = window.__tmAppVersion ?? "0.8.5";
        // Keep the bridge lineage explicit for future diagnostics. Older MCP
        // servers safely ignore this extra field.
        message.bridgeVersion = "0.5.7";
        return originalSend.call(this, JSON.stringify(message));
      }
    } catch {
      // Not JSON: pass through unchanged.
    }
  }
  return originalSend.call(this, data);
};
