const https = require("node:https");
const http = require("node:http");
const { URL } = require("node:url");

function isTTSConfigured(config = {}) {
  return Boolean(config.apiKey);
}

// Simple HTTPS-over-HTTP-proxy agent using HTTP CONNECT tunneling
function createProxyAgent(proxyUrl) {
  if (!proxyUrl) return undefined;

  const parsed = new URL(proxyUrl);
  const proxyHost = parsed.hostname;
  const proxyPort = Number(parsed.port) || 3128;

  return new https.Agent({
    createConnection(options, cb) {
      const targetHost = options.hostname || options.host;
      const targetPort = options.port || 443;

      const req = http.request({
        host: proxyHost,
        port: proxyPort,
        method: "CONNECT",
        path: `${targetHost}:${targetPort}`,
        headers: { host: `${targetHost}:${targetPort}` },
      });

      req.on("connect", (_res, socket) => {
        // Upgrade the tunnel to TLS
        const tlsOptions = {
          socket,
          host: targetHost,
          servername: targetHost,
          rejectUnauthorized: true,
        };
        const tlsSocket = require("node:tls").connect(tlsOptions, () => {
          cb(null, tlsSocket);
        });
        tlsSocket.on("error", (e) => cb(e));
      });

      req.on("error", (e) => cb(e));
      req.end();
    },
  });
}

async function speak(text, config = {}) {
  if (!isTTSConfigured(config)) return null;

  const baseUrl = (config.baseUrl || "https://api.fish.audio").replace(/\/+$/, "");
  const model = config.model || "fish-speech-1.5";
  const voice = config.voice || "default";
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";

  const body = JSON.stringify({
    text: String(text).slice(0, 500),
    model,
    ...(voice && voice !== "default" ? { reference_id: voice } : {}),
  });

  const targetUrl = new URL(`${baseUrl}/v1/tts`);
  const timeoutMs = config.timeoutMs || 20000;

  // Use proxy CONNECT tunnel if available, otherwise direct HTTPS
  return new Promise((resolve) => {
    const makeRequest = (socket) => {
      const req = https.request({
        host: targetUrl.hostname,
        port: targetUrl.port || 443,
        path: targetUrl.pathname + (targetUrl.search || ""),
        method: "POST",
        createConnection: () => socket,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Authorization: `Bearer ${config.apiKey}`,
        },
        timeout: timeoutMs,
      }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          if (res.statusCode === 200) {
            resolve(buffer);
          } else {
            const err = buffer.toString().slice(0, 200);
            console.log(`[tts] Fish Audio error ${res.statusCode}: ${err}`);
            resolve(null);
          }
        });
      });
      req.on("error", (e) => {
        console.log(`[tts] request error: ${e.message}`);
        resolve(null);
      });
      req.on("timeout", () => { req.destroy(); resolve(null); });
      req.write(body);
      req.end();
    };

    if (proxyUrl) {
      // CONNECT tunnel through proxy
      const proxy = new URL(proxyUrl);
      const conn = http.request({
        host: proxy.hostname,
        port: Number(proxy.port) || 3128,
        method: "CONNECT",
        path: `${targetUrl.hostname}:${targetUrl.port || 443}`,
        headers: { host: `${targetUrl.hostname}:${targetUrl.port || 443}` },
        timeout: timeoutMs,
      });

      conn.on("connect", (_res, socket) => {
        const tlsOpts = {
          socket,
          host: targetUrl.hostname,
          servername: targetUrl.hostname,
        };
        const tlsSocket = require("tls").connect(tlsOpts, () => makeRequest(tlsSocket));
        tlsSocket.on("error", (e) => {
          console.log(`[tts] TLS error: ${e.message}`);
          resolve(null);
        });
      });
      conn.on("error", (e) => {
        console.log(`[tts] proxy error: ${e.message}`);
        resolve(null);
      });
      conn.on("timeout", () => { conn.destroy(); resolve(null); });
      conn.end();
    } else {
      // Direct HTTPS
      makeRequest(undefined);
    }
  });
}

module.exports = { speak, isTTSConfigured };
