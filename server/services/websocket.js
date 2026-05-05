const crypto = require("node:crypto");

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function createWebSocketServer(httpServer, { path = "/chat-ws" } = {}) {
  const sockets = new Map(); // socketId -> socket
  let nextId = 1;
  let onMessageHandler = null;

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);

    // Only handle our WebSocket path
    if (url.pathname !== path) {
      socket.destroy();
      return;
    }

    const key = request.headers["sec-websocket-key"];
    if (!key) {
      socket.destroy();
      return;
    }

    // WebSocket handshake (RFC 6455 Section 4.2.2)
    const accept = crypto
      .createHash("sha1")
      .update(key + WS_MAGIC)
      .digest("base64");

    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n` +
        "\r\n"
    );

    const socketId = String(nextId++);
    let buffer = Buffer.alloc(0);

    sockets.set(socketId, socket);

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      // Try to parse a complete frame
      while (buffer.length >= 2) {
        const firstByte = buffer[0];
        const opcode = firstByte & 0x0f;
        const secondByte = buffer[1];
        const masked = (secondByte & 0x80) !== 0;

        // We only handle text frames (opcode 0x1) and close frames (0x8)
        if (opcode === 0x8) {
          // Close frame — send close back and remove
          const closeFrame = Buffer.from([0x88, 0x00]);
          try { socket.write(closeFrame); } catch (_) {}
          socket.destroy();
          sockets.delete(socketId);
          return;
        }

        if (opcode !== 0x1) {
          // Ignore non-text frames (ping/pong/etc.)
          // For pings (0x9), send pong
          if (opcode === 0x9) {
            const pongFrame = Buffer.from([0x8a, secondByte & 0x7f]);
            try { socket.write(pongFrame); } catch (_) {}
          }
          buffer = Buffer.alloc(0);
          return;
        }

        let payloadLength = secondByte & 0x7f;
        let offset = 2;

        if (payloadLength === 126) {
          if (buffer.length < 4) return; // Need more data
          payloadLength = buffer.readUInt16BE(2);
          offset = 4;
        } else if (payloadLength === 127) {
          if (buffer.length < 10) return;
          // Read as 64-bit, but clamp (chat messages won't be near 64KB)
          const hi = buffer.readUInt32BE(2);
          const lo = buffer.readUInt32BE(6);
          if (hi > 0) {
            // Frame too large for our use case
            socket.destroy();
            sockets.delete(socketId);
            return;
          }
          payloadLength = lo;
          offset = 10;
        }

        const maskOffset = offset;
        const dataStart = maskOffset + (masked ? 4 : 0);

        if (buffer.length < dataStart + payloadLength) return; // Need more data

        let payload;
        if (masked) {
          const mask = buffer.slice(maskOffset, maskOffset + 4);
          const data = buffer.slice(dataStart, dataStart + payloadLength);
          payload = Buffer.allocUnsafe(payloadLength);
          for (let i = 0; i < payloadLength; i++) {
            payload[i] = data[i] ^ mask[i % 4];
          }
        } else {
          payload = buffer.slice(dataStart, dataStart + payloadLength);
        }

        // Remove this frame from buffer
        buffer = buffer.slice(dataStart + payloadLength);

        // Dispatch message
        const text = payload.toString("utf8");
        if (onMessageHandler) {
          try {
            onMessageHandler(socketId, text);
          } catch (e) {
            console.log(`[ws] onMessage error: ${e.message}`);
          }
        }
      }
    });

    socket.on("close", () => {
      sockets.delete(socketId);
    });

    socket.on("error", () => {
      sockets.delete(socketId);
      try { socket.destroy(); } catch (_) {}
    });
  });

  function send(socketId, data) {
    const socket = sockets.get(String(socketId));
    if (!socket) return false;

    const payload = Buffer.from(String(data), "utf8");
    const len = payload.length;

    let frame;
    if (len < 126) {
      frame = Buffer.allocUnsafe(2 + len);
      frame[0] = 0x81; // FIN + text opcode
      frame[1] = len;
      payload.copy(frame, 2);
    } else if (len < 65536) {
      frame = Buffer.allocUnsafe(4 + len);
      frame[0] = 0x81;
      frame[1] = 126;
      frame.writeUInt16BE(len, 2);
      payload.copy(frame, 4);
    } else {
      // Not supporting >64KB frames for chat
      return false;
    }

    try {
      socket.write(frame);
      return true;
    } catch (_) {
      sockets.delete(String(socketId));
      return false;
    }
  }

  return {
    onMessage(handler) { onMessageHandler = handler; },
    send,
    clientCount() { return sockets.size; },
  };
}

module.exports = { createWebSocketServer };
