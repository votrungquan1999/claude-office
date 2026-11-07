import { createServer } from "node:http";

const MAX_BODY_BYTES = 256 * 1024;

export interface Listener {
  port: number;
  close(): Promise<void>;
}

/**
 * Listens on loopback only for events from the hook script.
 * @param token - The bearer token the hook must present.
 * @param onEvent - Called with each parsed JSON body.
 * @returns The bound port and a way to close.
 */
export function startListener(
  token: string,
  onEvent: (body: unknown) => void,
): Promise<Listener> {
  const server = createServer((request, response) => {
    if (
      request.method !== "POST" ||
      request.url !== "/events" ||
      request.headers.authorization !== `Bearer ${token}`
    ) {
      response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        response.writeHead(413).end();
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (response.writableEnded) return;
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        response.writeHead(400).end();
        return;
      }
      onEvent(body);
      response.writeHead(204).end();
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("The listener has no port."));
        return;
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
