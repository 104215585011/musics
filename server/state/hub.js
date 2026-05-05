function createDefaultSnapshot() {
  return {
    now: {
      track: null,
      transport: {
        canPlay: false,
        canPause: false,
        canSeek: false,
        volume: 0,
      },
      meta: {
        ready: false,
        message: "Not ready",
      },
    },
    next: [],
    taste: {
      tags: ["night drive", "late radio", "synth pop"],
      weights: {
        "night drive": 0.94,
        "late radio": 0.89,
        "synth pop": 0.83,
      },
      mood: "neon nocturne",
    },
    plan: {
      items: [
        { time: "07:00", label: "Wake-up warm start" },
        { time: "21:30", label: "Late-night radio block" },
      ],
    },
    status: {
      ready: false,
      message: "Not ready",
    },
    lastUpdatedAt: 0,
  };
}

function createHubState() {
  let snapshot = createDefaultSnapshot();

  function stamp(next) {
    snapshot = {
      ...snapshot,
      ...next,
      lastUpdatedAt: Date.now(),
    };
    return snapshot;
  }

  return {
    get() {
      return snapshot;
    },
    replace(next) {
      return stamp(next);
    },
    setNow(now) {
      return stamp({
        now,
        status: {
          ready: Boolean(now?.meta?.ready),
          message: now?.meta?.message ?? "",
        },
      });
    },
    setNext(next) {
      return stamp({ next: Array.isArray(next) ? next : [] });
    },
    setTaste(taste) {
      return stamp({ taste });
    },
    setPlan(plan) {
      return stamp({ plan });
    },
  };
}

module.exports = {
  createDefaultSnapshot,
  createHubState,
};
