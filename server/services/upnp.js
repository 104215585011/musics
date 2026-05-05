// Minimal UPnP client: SSDP discovery + AVTransport SOAP control
// Zero dependencies — pure Node.js (dgram + http)

const dgram = require("node:dgram");
const http = require("node:http");

const SSDP_ADDR = "239.255.255.250";
const SSDP_PORT = 1900;
const SSDP_MX = 3; // seconds to wait for responses

const MSEARCH_TEMPLATE =
  "M-SEARCH * HTTP/1.1\r\n" +
  "HOST: 239.255.255.250:1900\r\n" +
  "MAN: \"ssdp:discover\"\r\n" +
  "MX: " + SSDP_MX + "\r\n" +
  "ST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n" +
  "\r\n";

const SOAP_PLAY = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:SetAVTransportURI xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <InstanceID>0</InstanceID>
      <CurrentURI>{{URL}}</CurrentURI>
      <CurrentURIMetaData>{{METADATA}}</CurrentURIMetaData>
    </u:SetAVTransportURI>
  </s:Body>
</s:Envelope>`;

const SOAP_PLAY_ACTION = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:Play xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <InstanceID>0</InstanceID>
      <Speed>1</Speed>
    </u:Play>
  </s:Body>
</s:Envelope>`;

const SOAP_PAUSE = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:Pause xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <InstanceID>0</InstanceID>
    </u:Pause>
  </s:Body>
</s:Envelope>`;

const SOAP_STOP = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:Stop xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <InstanceID>0</InstanceID>
    </u:Stop>
  </s:Body>
</s:Envelope>`;

const SOAP_SET_VOLUME = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:SetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
      <InstanceID>0</InstanceID>
      <Channel>Master</Channel>
      <DesiredVolume>{{VOLUME}}</DesiredVolume>
    </u:SetVolume>
  </s:Body>
</s:Envelope>`;

const SOAP_GET_TRANSPORT = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetTransportInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <InstanceID>0</InstanceID>
    </u:GetTransportInfo>
  </s:Body>
</s:Envelope>`;

function createUPnPService() {
  let connectedDevice = null; // { name, host, port, controlUrl, renderingControlUrl }
  let currentState = "STOPPED";

  function buildMetadata(title, artist) {
    const escapedTitle = String(title || "Unknown").replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const escapedArtist = String(artist || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item><dc:title>${escapedTitle}</dc:title><dc:creator>${escapedArtist}</dc:creator><upnp:class>object.item.audioItem.musicTrack</upnp:class></item></DIDL-Lite>`;
  }

  async function discover() {
    return new Promise((resolve) => {
      const devices = [];
      const socket = dgram.createSocket("udp4");
      let timer;

      socket.on("message", (msg) => {
        const text = msg.toString();
        const locationMatch = text.match(/LOCATION:\s*(.+)/i);
        const serverMatch = text.match(/SERVER:\s*(.+)/i);
        const usnMatch = text.match(/USN:\s*(.+)/i);

        if (locationMatch) {
          const url = locationMatch[1].trim();
          const host = usnMatch?.[1]?.trim() || serverMatch?.[1]?.trim() || url;
          devices.push({
            name: host.slice(0, 60),
            location: url,
            server: serverMatch?.[1]?.trim() || "",
          });
        }
      });

      socket.on("error", () => {
        clearTimeout(timer);
        try { socket.close(); } catch (_) {}
        resolve(devices);
      });

      // Send M-SEARCH
      socket.bind(() => {
        socket.setBroadcast(true);
        socket.send(MSEARCH_TEMPLATE, SSDP_PORT, SSDP_ADDR);
      });

      // Wait for responses
      timer = setTimeout(() => {
        try { socket.close(); } catch (_) {}
        resolve(devices);
      }, SSDP_MX * 1000 + 500);
    });
  }

  async function fetchDeviceInfo(device) {
    try {
      const locationUrl = device.location;
      const parsed = new URL(locationUrl);
      const resp = await new Promise((resolve, reject) => {
        const req = http.get(locationUrl, { timeout: 5000 }, (res) => {
          let data = "";
          res.on("data", (chunk) => { data += chunk; });
          res.on("end", () => resolve(data));
        });
        req.on("error", reject);
        req.setTimeout?.(5000, () => { req.destroy(); reject(new Error("timeout")); });
      });

      // Parse XML to find friendlyName and AVTransport control URL
      const nameMatch = resp.match(/<friendlyName>([^<]+)<\/friendlyName>/);
      const controlMatch = resp.match(/<controlURL>([^<]+)<\/controlURL>/);
      const serviceTypeMatch = resp.match(/<serviceType>urn:schemas-upnp-org:service:AVTransport[^<]*<\/serviceType>/);

      const baseUrl = `${parsed.protocol}//${parsed.hostname}:${parsed.port}`;
      let controlUrl = controlMatch?.[1] || "";

      // Also find RenderingControl URL
      const rcMatch = resp.match(/<serviceType>urn:schemas-upnp-org:service:RenderingControl[^<]*<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>/);
      const rcControlUrl = rcMatch?.[1] || controlUrl; // Fallback to same

      if (controlUrl && !controlUrl.startsWith("http")) {
        controlUrl = baseUrl + (controlUrl.startsWith("/") ? "" : "/") + controlUrl;
      }

      let finalRcUrl = rcControlUrl;
      if (finalRcUrl && !finalRcUrl.startsWith("http")) {
        finalRcUrl = baseUrl + (finalRcUrl.startsWith("/") ? "" : "/") + finalRcUrl;
      }

      return {
        name: nameMatch?.[1] || device.name || "Unknown Renderer",
        host: parsed.hostname,
        port: parsed.port,
        controlUrl,
        renderingControlUrl: finalRcUrl,
        manufacturer: (resp.match(/<manufacturer>([^<]+)<\/manufacturer>/) || [])[1] || "",
      };
    } catch (e) {
      return null;
    }
  }

  async function discoverDevices() {
    const rawDevices = await discover();
    const results = [];
    for (const d of rawDevices) {
      const info = await fetchDeviceInfo(d);
      if (info?.controlUrl) {
        results.push(info);
      }
    }
    return results;
  }

  async function soapRequest(host, port, controlUrl, soapBody, soapAction) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(controlUrl);
      const req = http.request({
        hostname: parsed.hostname || host,
        port: parsed.port || port,
        path: parsed.pathname + (parsed.search || ""),
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPACTION: `"${soapAction}"`,
          "Content-Length": Buffer.byteLength(soapBody, "utf8"),
        },
        timeout: 10000,
      }, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => resolve(data));
      });

      req.on("error", reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error("SOAP timeout")); });
      req.write(soapBody);
      req.end();
    });
  }

  async function connect(device) {
    if (!device?.controlUrl) return false;
    // Test connection with GetTransportInfo
    try {
      await soapRequest(
        device.host, device.port, device.controlUrl,
        SOAP_GET_TRANSPORT,
        "urn:schemas-upnp-org:service:AVTransport:1#GetTransportInfo"
      );
      connectedDevice = device;
      console.log(`[upnp] Connected to ${device.name}`);
      return true;
    } catch (e) {
      console.log(`[upnp] Failed to connect to ${device.name}: ${e.message}`);
      return false;
    }
  }

  function disconnect() {
    if (connectedDevice) {
      console.log(`[upnp] Disconnected from ${connectedDevice.name}`);
      connectedDevice = null;
    }
  }

  function isConnected() {
    return connectedDevice !== null;
  }

  function currentDevice() {
    return connectedDevice;
  }

  async function play(url, metadata) {
    if (!connectedDevice) return false;
    const { host, port, controlUrl } = connectedDevice;
    try {
      const title = metadata?.title || "";
      const artist = metadata?.artist || "";
      const metaXml = buildMetadata(title, artist);
      const body = SOAP_PLAY.replace("{{URL}}", url).replace("{{METADATA}}", metaXml);

      await soapRequest(host, port, controlUrl, body, "urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI");
      // Small delay then Play
      await new Promise(r => setTimeout(r, 300));
      await soapRequest(host, port, controlUrl, SOAP_PLAY_ACTION, "urn:schemas-upnp-org:service:AVTransport:1#Play");

      currentState = "PLAYING";
      console.log(`[upnp] Playing: ${title || url}`);
      return true;
    } catch (e) {
      console.log(`[upnp] play error: ${e.message}`);
      return false;
    }
  }

  async function pause() {
    if (!connectedDevice) return false;
    try {
      await soapRequest(
        connectedDevice.host, connectedDevice.port, connectedDevice.controlUrl,
        SOAP_PAUSE, "urn:schemas-upnp-org:service:AVTransport:1#Pause"
      );
      currentState = "PAUSED";
      return true;
    } catch { return false; }
  }

  async function stop() {
    if (!connectedDevice) return false;
    try {
      await soapRequest(
        connectedDevice.host, connectedDevice.port, connectedDevice.controlUrl,
        SOAP_STOP, "urn:schemas-upnp-org:service:AVTransport:1#Stop"
      );
      currentState = "STOPPED";
      return true;
    } catch { return false; }
  }

  async function setVolume(level) {
    if (!connectedDevice || !connectedDevice.renderingControlUrl) return false;
    try {
      const body = SOAP_SET_VOLUME.replace("{{VOLUME}}", String(Math.max(0, Math.min(100, Number(level)))));
      await soapRequest(
        connectedDevice.host, connectedDevice.port, connectedDevice.renderingControlUrl,
        body, "urn:schemas-upnp-org:service:RenderingControl:1#SetVolume"
      );
      return true;
    } catch { return false; }
  }

  async function getStatus() {
    if (!connectedDevice) return { transportState: "DISCONNECTED", volume: 0 };
    try {
      const resp = await soapRequest(
        connectedDevice.host, connectedDevice.port, connectedDevice.controlUrl,
        SOAP_GET_TRANSPORT, "urn:schemas-upnp-org:service:AVTransport:1#GetTransportInfo"
      );
      const stateMatch = resp.match(/<CurrentTransportState>([^<]+)<\/CurrentTransportState>/);
      return {
        transportState: stateMatch?.[1] || currentState,
        volume: 0, // Would need separate GetVolume call
      };
    } catch {
      return { transportState: "ERROR", volume: 0 };
    }
  }

  return {
    discover: discoverDevices,
    connect,
    disconnect,
    play,
    pause,
    stop,
    setVolume,
    getStatus,
    isConnected,
    currentDevice,
  };
}

module.exports = { createUPnPService };
