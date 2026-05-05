const fs = require("node:fs");
const path = require("node:path");

const USER_DIR = path.join(process.cwd(), "user");
const ALLOWED_FILES = ["taste.md", "routines.md", "mood-rules.md", "playlists.json"];

const TEMPLATES = {
  "taste.md": `# 我的音乐品味

## 喜欢的风格
- Synthwave / Retrowave
- Chinese indie pop
- Lo-fi hip hop
- Post-rock

## 不喜欢的
- 太吵闹的重金属
- 过度商业化的流行

## 场景偏好
- 深夜开车：Synthwave
- 写代码：Lo-fi / 轻音乐
- 周末早晨：独立民谣
- 下雨天：Jazz / Ambient
`,

  "routines.md": `# 我的日常听歌习惯

## 工作日
- 09:00 — 轻音乐开始一天
- 10:00-12:00 — 专注编码，Lo-fi / Instrumental
- 14:00-18:00 — 根据心情，通常流行或独立
- 21:00-23:00 — 晚间电台，放松为主

## 周末
- 随意，偏向放松和发现新音乐
- 下午可能听一些有能量的音乐
`,

  "mood-rules.md": `# 心情 → 音乐映射

| 心情 | 风格 | 例子 |
|------|------|------|
| 开心 / energetic | 欢快流行、电子 | 周杰伦、Daft Punk |
| 疲惫 / tired | Chill / Lo-fi | Study beats、Nujabes |
| 焦虑 / stressed | 古典 / 氛围 | Max Richter、Brian Eno |
| 想放松 / relaxed | 爵士 / R&B | Frank Ocean、Chet Baker |
| 专注 / focused | Instrumental / Post-rock | Explosions in the Sky |
| 怀旧 / nostalgic | 80s / Synthwave | The Midnight、FM-84 |
`,

  "playlists.json": JSON.stringify({
    description: "个人歌单标注 — 给歌单起昵称、打标签、写备注",
    annotations: [
      {
        playlistId: "",
        nickname: "我的深夜开车歌单",
        tags: ["night-drive", "synth"],
        notes: "最适合晚上10点以后听"
      }
    ]
  }, null, 2),
};

function safePath(name) {
  const basename = path.basename(name);
  if (!ALLOWED_FILES.includes(basename)) return null;
  return path.join(USER_DIR, basename);
}

function ensureUserDir() {
  if (!fs.existsSync(USER_DIR)) {
    fs.mkdirSync(USER_DIR, { recursive: true });
    // Create template files
    for (const [name, content] of Object.entries(TEMPLATES)) {
      const filePath = path.join(USER_DIR, name);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, content, "utf8");
        console.log(`[user-files] Created template: ${name}`);
      }
    }
  }
}

function listUserFiles() {
  ensureUserDir();
  return ALLOWED_FILES.map(name => {
    const filePath = path.join(USER_DIR, name);
    const exists = fs.existsSync(filePath);
    return {
      name,
      exists,
      size: exists ? fs.statSync(filePath).size : 0,
    };
  });
}

function readUserFile(name) {
  const filePath = safePath(name);
  if (!filePath || !fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
}

function writeUserFile(name, content) {
  const filePath = safePath(name);
  if (!filePath) return false;
  ensureUserDir();
  const tmpPath = filePath + ".tmp";
  fs.writeFileSync(tmpPath, String(content ?? ""), "utf8");
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (_e) {
    fs.copyFileSync(tmpPath, filePath);
    try { fs.unlinkSync(tmpPath); } catch (_) {}
  }
  return true;
}

function readAllUserFiles() {
  ensureUserDir();
  const result = {};
  for (const name of ALLOWED_FILES) {
    const content = readUserFile(name);
    if (content != null) result[name] = content;
  }
  return result;
}

module.exports = { listUserFiles, readUserFile, writeUserFile, readAllUserFiles, ensureUserDir };
