const { spawn } = require("node:child_process");

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function parseCliJsonOutput(output) {
  const cleaned = stripAnsi(String(output ?? "")).trim();
  if (!cleaned) {
    throw new Error("Empty ncm-cli output");
  }

  try {
    return JSON.parse(cleaned);
  } catch {}

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error(`Unable to parse ncm-cli json output: ${cleaned.slice(0, 200)}`);
  }

  return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
}

function parseCliConfigOutput(output) {
  const result = {
    appId: "",
    hasAppId: false,
    hasPrivateKey: false,
    player: "",
    playerConfigured: false,
  };

  const cleaned = stripAnsi(String(output ?? ""));
  for (const rawLine of cleaned.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !line.includes(":")) {
      continue;
    }

    const [rawKey, ...rawValueParts] = line.split(":");
    const key = rawKey.trim();
    const value = rawValueParts.join(":").trim();

    if (key === "appId") {
      result.appId = value.replace(/\s+\(.+\)$/, "").trim();
      result.hasAppId = Boolean(result.appId);
    }

    if (key === "privateKey") {
      result.hasPrivateKey = !value.startsWith("(未配置)");
    }

    if (key === "player") {
      result.player = value.startsWith("(未配置)") ? "" : value;
      result.playerConfigured = Boolean(result.player);
    }
  }

  return result;
}

function createCliActionArgs(commandArgs) {
  const args = [...commandArgs];
  if (!args.includes("--output")) {
    args.push("--output", "json");
  }
  return args;
}

function execCli(command, commandArgs, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15000;
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      windowsHide: true,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(stripAnsi(String(error.message || "ncm-cli execution failed")).trim()));
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error("ncm-cli execution timed out"));
        return;
      }

      if (code !== 0) {
        reject(new Error(stripAnsi(String(stderr || stdout || `ncm-cli exited with code ${code}`)).trim()));
        return;
      }

      resolve({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
      });
    });
  });
}

async function runCliJson(command, commandArgs, options = {}) {
  const result = await execCli(command, createCliActionArgs(commandArgs), options);
  return parseCliJsonOutput(result.stdout || result.stderr);
}

async function runCliText(command, commandArgs, options = {}) {
  const result = await execCli(command, commandArgs, options);
  return stripAnsi(result.stdout || result.stderr).trim();
}

function startCliLogin(command, onJson, onExit) {
  const child = spawn(command, ["login", "--background", "--output", "json"], {
    windowsHide: true,
    detached: false,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  let settled = false;
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
    if (settled) {
      return;
    }

    try {
      const payload = parseCliJsonOutput(stdout);
      settled = true;
      onJson(null, payload, child);
    } catch {}
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  child.on("error", (error) => {
    if (!settled) {
      settled = true;
      onJson(error);
    }
    onExit?.(error);
  });

  child.on("exit", (code) => {
    if (!settled && code !== 0) {
      settled = true;
      onJson(new Error(stripAnsi(stderr || stdout || `ncm-cli login exited with code ${code}`)));
    }
    onExit?.(code);
  });

  return child;
}

module.exports = {
  createCliActionArgs,
  execCli,
  parseCliConfigOutput,
  parseCliJsonOutput,
  runCliJson,
  runCliText,
  startCliLogin,
};
