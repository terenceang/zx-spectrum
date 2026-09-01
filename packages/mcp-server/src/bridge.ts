import { WebSocketServer, type WebSocket } from "ws";

/** Wire format between this bridge and the browser app's matching client in
 * packages/app/src/main.ts. Duplicated there rather than shared — it's a dozen
 * lines and the two sides build for different runtimes (Node vs. browser). */
export type BridgeCommand =
  | { reqId: string; cmd: "getStatus" }
  | { reqId: string; cmd: "readScreen" }
  | { reqId: string; cmd: "loadRom"; model: "48k" | "128k"; romBase64: string }
  | { reqId: string; cmd: "loadSnapshot"; format: "sna" | "z80"; dataBase64: string }
  | { reqId: string; cmd: "loadTape"; format: "tap" | "tzx"; dataBase64: string }
  | { reqId: string; cmd: "playTape" }
  | { reqId: string; cmd: "stopTape" }
  | { reqId: string; cmd: "reset" }
  | { reqId: string; cmd: "keyEvent"; row: number; bit: number; down: boolean }
  | { reqId: string; cmd: "typeText"; text: string };

export const BRIDGE_PORT = 8790;

const instances = new Map<string, WebSocket>();
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>();
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
    if (instanceId) instances.delete(instanceId);
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
