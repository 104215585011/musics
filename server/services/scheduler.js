const { buildFullContext } = require("./context-builder.js");
const { buildRadioPlan } = require("./personalization.js");

// Default schedule — overridden by user/routines.md
const DEFAULT_SCHEDULE = [
  { time: "07:00", action: "daily-plan" },
  { time: "09:00", action: "morning-greet" },
  { time: "21:30", action: "night-block" },
];

const MOOD_CHECK_INTERVAL_MINUTES = 60; // Every hour

function parseTime(timeStr) {
  const [h, m] = String(timeStr).split(":").map(Number);
  return { hour: h || 0, minute: m || 0 };
}

function parseRoutinesMd(content) {
  if (!content) return [];
  const items = [];
  const timeRegex = /(\d{2}:\d{2})\s*[-—]\s*(.+)/g;
  let match;
  while ((match = timeRegex.exec(content)) !== null) {
    const time = match[1];
    const label = match[2].trim();
    // Map labels to actions
    let action = "daily-plan";
    if (/起床|morning|早安|早间|开始/.test(label)) action = "morning-greet";
    else if (/晚间|night|晚安|电台|radio/.test(label)) action = "night-block";
    else if (/规划|plan/.test(label)) action = "daily-plan";
    items.push({ time, action, label });
  }
  return items.length ? items : DEFAULT_SCHEDULE;
}

function scheduleNext(now, targetTime) {
  const target = new Date(now);
  target.setHours(targetTime.hour, targetTime.minute, 0, 0);
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}

function startScheduler(deps = {}) {
  const { hub, store, music, brain, stream, weatherConfig, schedulerConfig } = deps;
  if (schedulerConfig?.enabled === false) {
    console.log("[scheduler] Disabled by config");
    return { stop() {} };
  }

  let stopped = false;
  let timers = [];

  // Read schedule from user routines
  let schedule = DEFAULT_SCHEDULE;
  try {
    const { readUserFile, ensureUserDir } = require("./user-files.js");
    ensureUserDir();
    const routines = readUserFile("routines.md");
    if (routines) {
      const parsed = parseRoutinesMd(routines);
      if (parsed.length) schedule = parsed;
    }
  } catch (_) { /* use defaults */ }

  console.log("[scheduler] Schedule:", schedule.map(s => `${s.time} ${s.action}`).join(", "));

  const customTimes = schedulerConfig?.times || {};
  const dailyPlanTime = parseTime(customTimes.dailyPlan || "07:00");
  const morningGreetTime = parseTime(customTimes.morningGreet || "09:00");
  const nightBlockTime = parseTime(customTimes.nightBlock || "21:30");
  const moodIntervalMs = (customTimes.moodCheckIntervalMinutes || MOOD_CHECK_INTERVAL_MINUTES) * 60 * 1000;

  // ---- Action handlers ----

  async function runDailyPlan() {
    console.log("[scheduler] Running daily-plan");
    try {
      const { buildPersonalizationSnapshot } = require("./personalization.js");
      const storeState = store?.get?.() ?? {};
      const now = await music?.getNow?.().catch(() => null) ?? null;
      const playlists = await music?.getPlaylists?.().catch(() => []) ?? [];
      const snapshot = buildPersonalizationSnapshot({ storeState, playlists, now, date: new Date() });
      if (snapshot?.plan) {
        hub.setPlan(snapshot.plan);
        stream.broadcast({ type: "plan", items: snapshot.plan.items });
        console.log("[scheduler] Plan updated and broadcast");
      }
    } catch (e) {
      console.log("[scheduler] daily-plan error:", e.message);
    }
  }

  async function runGreeting(label) {
    console.log(`[scheduler] Running greeting: ${label}`);
    try {
      const context = await buildFullContext({ music, store, weatherConfig }).catch(() => null);
      if (!context || !brain?.ask) return;

      const isMorning = label.includes("morning") || label.includes("早") || label.includes("早安");
      const prompt = isMorning
        ? "早上好！现在是早起时间，请用DJ的口吻做一个简短的早安播报（50字以内），提一下天气和今天适合听的音乐风格，然后推荐一首歌。"
        : "现在是晚间电台时间，请用DJ的口吻做一个简短的晚间问候（50字以内），提一下现在的氛围，然后推荐一首适合晚间听的歌。";

      const result = await brain.ask(prompt, {
        context,
        tools: brain.tools,
        executeTool: brain.executeTool,
      });

      const text = result?.reply || "";
      const rec = result?.recommendation || null;

      if (text) {
        stream.broadcast({
          type: "dj-speak",
          text,
          recommendation: rec,
          time: label,
        });
        store?.appendMessage?.("assistant", text, { intent: "scheduler", action: label });
      }
    } catch (e) {
      console.log(`[scheduler] greeting error:`, e.message);
    }
  }

  async function runMoodCheck() {
    try {
      const storeState = store?.get?.() ?? {};
      const messages = Array.isArray(storeState.messages) ? storeState.messages : [];
      // Analyze last 5 user messages for mood
      const recentUserMessages = messages
        .filter(m => m.role === "user")
        .slice(-5)
        .map(m => m.text || "");

      if (!recentUserMessages.length) return;

      const combined = recentUserMessages.join(" ");
      const { inferScene } = require("./personalization.js");
      const scene = inferScene({ now: new Date(), messages: recentUserMessages.map(t => ({ text: t })) });
      hub.setTaste({ ...hub.get().taste, mood: scene.mood });

      console.log(`[scheduler] Mood check: ${scene.mood} (from ${recentUserMessages.length} recent messages)`);
    } catch (e) {
      console.log(`[scheduler] mood-check error:`, e.message);
    }
  }

  // ---- Timer scheduling ----

  function scheduleTimeAction(timeObj, actionName, handler) {
    const delay = scheduleNext(new Date(), timeObj);
    const timer = setTimeout(async () => {
      if (stopped) return;
      try {
        if (actionName === "daily-plan") await runDailyPlan();
        else await handler(actionName);
      } catch (e) {
        console.log(`[scheduler] ${actionName} handler error:`, e.message);
      }
      // Re-schedule for next day
      if (!stopped) scheduleTimeAction(timeObj, actionName, handler);
    }, delay);
    timers.push(timer);
    console.log(`[scheduler] ${actionName} scheduled in ${Math.round(delay / 1000 / 60)} min`);
  }

  function scheduleMoodCheck() {
    const timer = setTimeout(async () => {
      if (stopped) return;
      await runMoodCheck();
      if (!stopped) scheduleMoodCheck();
    }, moodIntervalMs);
    timers.push(timer);
    console.log(`[scheduler] mood-check every ${moodIntervalMs / 60000} min`);
  }

  // Start all scheduled actions
  scheduleTimeAction(dailyPlanTime, "daily-plan", async () => runDailyPlan());
  scheduleTimeAction(morningGreetTime, "morning-greet", (label) => runGreeting(label));
  scheduleTimeAction(nightBlockTime, "night-block", (label) => runGreeting(label));
  scheduleMoodCheck();

  // Also run daily plan immediately on startup
  runDailyPlan().catch(() => {});

  return {
    stop() {
      stopped = true;
      timers.forEach(t => clearTimeout(t));
      timers = [];
      console.log("[scheduler] Stopped");
    },
    // Manual trigger for testing
    async trigger(action) {
      if (action === "daily-plan") return runDailyPlan();
      if (action === "morning-greet") return runGreeting("morning-greet");
      if (action === "night-block") return runGreeting("night-block");
      if (action === "mood-check") return runMoodCheck();
    },
  };
}

module.exports = { startScheduler };
