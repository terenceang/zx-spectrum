import { WebSocketServer, type WebSocket } from "ws";
import { type BridgeCommand, MCP_BRIDGE_PORT as BRIDGE_PORT } from "../../core/dist/index.js";

export type { BridgeCommand };
export { BRIDGE_PORT };

const instances = new Map<string, WebSocket>();
const pending = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (reason: Error) => void; ws: WebSocket }
>();
let reqCounter = 0;

const wss = new WebSocketServer({ port: BRIDGE_PORT });

wss.on("connection", (ws) => {
  let instanceId: string | null = null;

  ws.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as {
      type?: string;
      instanceId?: string;
      reqId?: string;
      ok?: boolean;
      result?: unknown;
      error?: string;
    };
    if (message.type === "hello" && message.instanceId) {
      instanceId = message.instanceId;
      instances.set(instanceId, ws);
      return;
    }
    if (!message.reqId) return;
    const waiting = pending.get(message.reqId);
    if (!waiting) return;
    pending.delete(message.reqId);
    if (message.ok) waiting.resolve(message.result);
    else waiting.reject(new Error(message.error ?? "Unknown error from browser instance."));
  });

  ws.on("close", () => {
    if (instanceId) {
      instances.delete(instanceId);
      // Clean up any pending requests that were awaiting a reply over this socket.
      for (const [reqId, entry] of pending) {
        if (entry.ws === ws) {
          entry.reject(new Error(`Instance "${instanceId}" disconnected before responding.`));
          pending.delete(reqId);
        }
      }
    }
  });
});

export function connectedInstanceIds(): string[] {
  return [...instances.keys()];
}

/** Which browser instance a tool call should target: the named one, the sole
 * connected one, or null (caller falls back to the headless machine). Throws
 * if the name doesn't match a connected instance, or several are connected
 * and none was named. */
export function resolveInstance(instanceId?: string): string | null {
  if (instanceId) {
    if (!instances.has(instanceId)) {
      throw new Error(
        `No connected instance "${instanceId}". Connected: ${connectedInstanceIds().join(", ") || "(none)"}`,
      );
    }
    return instanceId;
  }
  const ids = connectedInstanceIds();
  if (ids.length === 0) return null;
  if (ids.length === 1) return ids[0]!;
  throw new Error(`Multiple browser instances connected (${ids.join(", ")}) — pass instanceId to pick one.`);
}

export function callInstance(
  instanceId: string,
  cmd: BridgeCommand["cmd"],
  payload: Record<string, unknown> = {},
): Promise<unknown> {
  const ws = instances.get(instanceId);
  if (!ws) throw new Error(`Instance "${instanceId}" is no longer connected.`);
  const reqId = String(++reqCounter);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(reqId);
      reject(new Error(`Instance "${instanceId}" did not respond within 5s.`));
    }, 5000);
    pending.set(reqId, {
      ws,
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    ws.send(JSON.stringify({ reqId, cmd, ...payload }));
  });
}
