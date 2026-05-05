// Claudio app shell interactions
(function tickClock() {
  var el = document.querySelector("[data-clock]");
  if (!el) return;
  function paint() {
    var d = new Date();
    el.textContent =
      String(d.getHours()).padStart(2, "0") +
      ":" +
      String(d.getMinutes()).padStart(2, "0");
  }
  paint();
  setInterval(paint, 30000);
})();

// service worker registration + upgrade prompt
(function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol === "file:") return;

  var toast = document.querySelector("[data-sw-toast]");
  var reloadBtn = document.querySelector("[data-sw-reload]");
  var dismissBtn = document.querySelector("[data-sw-dismiss]");
  var pendingWorker = null;
  var reloadingForUpdate = false;

  function showToast() {
    if (!toast) return;
    toast.hidden = false;
    requestAnimationFrame(function () {
      toast.classList.add("is-visible");
    });
  }
  function hideToast() {
    if (!toast) return;
    toast.classList.remove("is-visible");
    setTimeout(function () { toast.hidden = true; }, 220);
  }

  if (dismissBtn) {
    dismissBtn.addEventListener("click", hideToast);
  }
  if (reloadBtn) {
    reloadBtn.addEventListener("click", function () {
      reloadingForUpdate = true;
      if (pendingWorker) {
        pendingWorker.postMessage("skip-waiting");
      }
      setTimeout(function () {
        window.location.reload();
      }, 700);
    });
  }

  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (reloadingForUpdate) {
      reloadingForUpdate = false;
      window.location.reload();
    }
  });

  function trackInstalling(worker) {
    if (!worker) return;
    worker.addEventListener("statechange", function () {
      if (worker.state === "installed" && navigator.serviceWorker.controller) {
        pendingWorker = worker;
        showToast();
      }
    });
  }

  window.addEventListener("load", function () {
    navigator.serviceWorker
      .register("./sw.js")
      .then(function (reg) {
        if (reg.waiting && navigator.serviceWorker.controller) {
          pendingWorker = reg.waiting;
          showToast();
        }
        trackInstalling(reg.installing);
        reg.addEventListener("updatefound", function () {
          trackInstalling(reg.installing);
        });
      })
      .catch(function (err) {
        console.warn("[claudio] SW register failed:", err);
      });
  });
})();

// ============== scene tweaks (moved out of [data-player]) ==============
(function tweakWires() {
  var inputs = document.querySelectorAll("[data-tweak]");
  function apply(input) {
    var target = document.documentElement;
    if (input.dataset.tweak === "tone") target.style.setProperty("--hero-hue", input.value);
    if (input.dataset.tweak === "blue") target.style.setProperty("--blue-hue", input.value);
    if (input.dataset.tweak === "blur") target.style.setProperty("--glass-blur", input.value + "px");
  }
  inputs.forEach(function (input) {
    apply(input);
    input.addEventListener("input", function () { apply(input); });
  });
})();

// ============== view router ==============
(function viewRouter() {
  var body = document.body;
  var tabs = document.querySelectorAll("[data-view-tab]");
  var views = document.querySelectorAll("[data-view]");
  var fab = document.querySelector("[data-settings-toggle]");

  function setView(name) {
    if (!name) return;
    body.dataset.activeView = name;
    tabs.forEach(function (t) {
      t.classList.toggle("is-active", t.dataset.viewTab === name);
    });
    views.forEach(function (v) {
      var on = v.dataset.view === name;
      v.classList.toggle("is-active", on);
      v.hidden = !on;
    });
    if (location.hash !== "#" + name) {
      history.replaceState(null, "", "#" + name);
    }
    if (fab) fab.classList.toggle("is-open", name === "settings");
    if (name === "profile") loadProfile();
  }

  tabs.forEach(function (t) {
    t.addEventListener("click", function () {
      setView(t.dataset.viewTab);
    });
  });

  if (fab) {
    fab.addEventListener("click", function () {
      var current = body.dataset.activeView;
      if (current === "settings") {
        setView("player");
      } else {
        setView("settings");
      }
    });
  }

  window.addEventListener("hashchange", function () {
    var name = (location.hash || "#player").slice(1);
    if (name === "player" || name === "profile" || name === "settings") {
      setView(name);
    }
  });

  var initial = (location.hash || "#player").slice(1);
  if (initial !== "player" && initial !== "profile" && initial !== "settings") {
    initial = "player";
  }
  setView(initial);

  window.claudio = window.claudio || {};
  window.claudio.setView = setView;
})();

// ============== profile loader ==============
async function loadProfile() {
  if (!window.claudio || !window.claudio.api) return;
  var api = window.claudio.api;

  var tasteEl = document.querySelector("[data-taste-tags]");
  var planEl = document.querySelector("[data-plan-list]");
  var playlistEl = document.querySelector("[data-playlist-list]");
  var nowTitleEl = document.querySelector("[data-now-title]");
  var nowSubEl = document.querySelector("[data-now-sub]");
  var memoryPlaysEl = document.querySelector("[data-memory-plays]");
  var memoryFailedEl = document.querySelector("[data-memory-failed]");
  var contextSceneEl = document.querySelector("[data-context-scene]");
  var contextPickEl = document.querySelector("[data-context-pick]");
  var contextReasonEl = document.querySelector("[data-context-reason]");
  var playlistFilters = { hideLocked: false, hideFailed: false };

  function renderTaste(payload) {
    if (!tasteEl || !payload || !Array.isArray(payload.tags)) return;
    tasteEl.innerHTML = "";
    payload.tags.forEach(function (tag) {
      var span = document.createElement("span");
      span.className = "taste-tag";
      span.textContent = tag;
      tasteEl.appendChild(span);
    });
  }

  function renderPlan(payload) {
    if (!planEl || !payload || !Array.isArray(payload.items)) return;
    planEl.innerHTML = "";
    payload.items.forEach(function (item) {
      var li = document.createElement("li");
      li.className = "plan-item";
      li.innerHTML =
        '<span class="plan-item__time">' +
        (item.time || "") +
        '</span><span class="plan-item__label">' +
        (item.label || "") +
        "</span>";
      planEl.appendChild(li);
    });
  }

  function renderPersonalization(snapshot) {
    if (!snapshot) return;
    if (snapshot.profile) renderTaste({ tags: snapshot.profile.tags || [] });
    if (snapshot.plan) renderPlan(snapshot.plan);

    var scene = snapshot.scene || {};
    var pick = snapshot.recommendation || {};
    if (contextSceneEl) {
      contextSceneEl.textContent = scene.summary || "local scene unavailable";
    }
    if (contextPickEl) {
      contextPickEl.textContent = pick.title
        ? "Next fit: " + pick.title + (pick.artist ? " · " + pick.artist : "")
        : "No playable recommendation yet";
    }
    if (contextReasonEl) {
      contextReasonEl.textContent =
        pick.reason || "Claudio is waiting for more plays, chats, and playlist context.";
    }
  }

  function getTrackStatus(track) {
    if (track.playState === "sending") return "sending";
    if (track.playState === "sent") return "sent";
    if (track.blockedReason) return "failed";
    if (track.canPlay === false) return "locked";
    return "try";
  }

  function shouldShowTrack(track) {
    var status = getTrackStatus(track);
    if (playlistFilters.hideLocked && status === "locked") return false;
    if (playlistFilters.hideFailed && status === "failed") return false;
    return true;
  }

  function applyPlaylistFilters(scope) {
    var root = scope || document;
    root.querySelectorAll(".playlist-track[data-track]").forEach(function (row) {
      var track = {};
      try {
        track = JSON.parse(row.dataset.track || "{}");
      } catch (_) {}
      row.classList.toggle("is-filtered-out", !shouldShowTrack(track));
    });
    document.querySelectorAll("[data-track-filter]").forEach(function (button) {
      button.classList.toggle("is-active", Boolean(playlistFilters[button.dataset.trackFilter]));
    });
  }

  document.querySelectorAll("[data-track-filter]").forEach(function (button) {
    if (button.dataset.wired === "1") return;
    button.dataset.wired = "1";
    button.addEventListener("click", function () {
      var key = button.dataset.trackFilter;
      playlistFilters[key] = !playlistFilters[key];
      applyPlaylistFilters();
    });
  });

  try {
    var personalization = api.personalization ? await api.personalization() : null;
    renderPersonalization(personalization);
  } catch (_) {
    if (contextSceneEl) contextSceneEl.textContent = "offline";
    if (contextPickEl) contextPickEl.textContent = "Context unavailable";
    if (contextReasonEl) contextReasonEl.textContent = "The local server did not return personalization yet.";
  }

  try {
    var taste = await api.taste();
    renderTaste(taste);
  } catch (_) {
    if (tasteEl && tasteEl.querySelector(".is-loading")) {
      tasteEl.innerHTML = '<span class="taste-tag is-empty">offline · taste unavailable</span>';
    }
  }

  try {
    var plan = await api.plan();
    renderPlan(plan);
  } catch (_) {
    if (planEl) planEl.innerHTML = '<li class="plan-item is-empty">no plan loaded</li>';
  }

  try {
    var playlists = await api.playlists();
    if (playlistEl && playlists && Array.isArray(playlists.items)) {
      playlistEl.innerHTML = "";
      // Server-side error (rate-limit, auth, transport) — surface it instead
      // of silently showing "no playlists found".
      if (playlists.error && playlists.items.length === 0) {
        var label;
        if (playlists.error.kind === "rate-limited") {
          label = "NetEase 限流 (-461) · 等几分钟再试";
        } else if (playlists.error.kind === "netease-error") {
          label = "NetEase: " + playlists.error.message + " (code " + playlists.error.code + ")";
        } else {
          label = playlists.error.message || "playlists unavailable";
        }
        playlistEl.innerHTML =
          '<li class="playlist-item is-error" title="' + label.replace(/"/g, "&quot;") + '">' +
          label + "</li>";
      } else {
        playlists.items.slice(0, 8).forEach(function (item) {
          var li = document.createElement("li");
          li.className = "playlist-item" + (item.selected ? " is-selected" : "");
          li.dataset.playlistId = item.encryptedId || "";
          li.innerHTML =
            '<span class="playlist-item__name">' +
            (item.title || "Untitled") +
            "</span>" +
            '<span class="playlist-item__count">' +
            (item.trackCount || 0) +
            " songs</span>" +
            '<ul class="playlist-track-list" hidden></ul>';
          li.addEventListener("click", function () {
            togglePlaylistTracks(li, item);
          });
          playlistEl.appendChild(li);
        });
        if (!playlists.items.length) {
          playlistEl.innerHTML = '<li class="playlist-item is-empty">no playlists found</li>';
        }
      }
    }
  } catch (_) {
    if (playlistEl) playlistEl.innerHTML = '<li class="playlist-item is-empty">playlists unavailable</li>';
  }

  async function togglePlaylistTracks(row, playlist) {
    var list = row.querySelector(".playlist-track-list");
    if (!list || !playlist || !playlist.encryptedId) return;
    if (row.classList.contains("is-open")) {
      row.classList.remove("is-open");
      list.hidden = true;
      return;
    }

    row.classList.add("is-open");
    list.hidden = false;
    if (list.dataset.loaded === "1") return;

    list.innerHTML = '<li class="playlist-track is-loading">loading songs...</li>';
    try {
      var tracks = await api.playlistTracks(playlist.encryptedId, 50);
      list.innerHTML = "";
      if (tracks && tracks.error && (!tracks.items || !tracks.items.length)) {
        var trackLabel;
        if (tracks.error.kind === "rate-limited") {
          trackLabel = "NetEase 限流 (-461) · 等几分钟再试";
        } else if (tracks.error.kind === "netease-error") {
          trackLabel = "NetEase: " + tracks.error.message + " (code " + tracks.error.code + ")";
        } else {
          trackLabel = tracks.error.message || "tracks unavailable";
        }
        list.innerHTML = '<li class="playlist-track is-error">' + trackLabel + "</li>";
        return;
      }
      var allTracks = tracks.items || [];
      var visibleCount = Math.min(10, allTracks.length);

      function appendTrack(track, index) {
        var song = document.createElement("li");
        track.playState = track.blockedReason ? "failed" : track.playState || "";
        song.className =
          "playlist-track" +
          (track.canPlay === false ? " is-unavailable" : "") +
          (track.blockedReason ? " is-failed" : "");
        song.dataset.track = JSON.stringify(track);
        var statusText = getTrackStatus(track);
        var statusTitle = track.blockedReason
          ? "Last play failed: " + track.blockedReason
          : track.canPlay === false
            ? "This track is not playable through the current NetEase account."
            : "Playable flag is positive; click to play through the NetEase API.";
        song.innerHTML =
          '<button class="playlist-track__button" type="button" title="' +
          statusTitle.replace(/"/g, "&quot;") +
          '">' +
          '<span class="playlist-track__index">' +
          String(index + 1).padStart(2, "0") +
          "</span>" +
          '<span class="playlist-track__main">' +
          '<span class="playlist-track__title">' +
          (track.title || "Untitled") +
          "</span>" +
          '<span class="playlist-track__artist">' +
          [track.artist, track.album].filter(Boolean).join(" · ") +
          "</span>" +
          "</span>" +
          '<span class="playlist-track__status">' +
          statusText +
          "</span>" +
          "</button>";
        var songButton = song.querySelector("button");
        if (track.canPlay === false) {
          songButton.disabled = true;
        }
        songButton.addEventListener("click", async function (event) {
          event.stopPropagation();
          if (track.canPlay === false) {
            return;
          }
          var statusEl = song.querySelector(".playlist-track__status");
          songButton.disabled = true;
          track.playState = "sending";
          song.dataset.track = JSON.stringify(track);
          statusEl.textContent = "sending";
          try {
            var result = await api.play(track);
            song.classList.toggle("is-failed", Boolean(result && result.success === false));
            if (result && result.success === false) {
              track.blockedReason = result.message || "NetEase API play failed";
              track.playState = "failed";
              song.dataset.track = JSON.stringify(track);
              statusEl.textContent = "failed";
              songButton.title = result.message || "NetEase API play failed";
            } else {
              track.playState = "sent";
              song.dataset.track = JSON.stringify(track);
              statusEl.textContent = "sent";
              if (window.claudio && typeof window.claudio.refreshNow === "function") {
                window.claudio.refreshNow();
              }
              if (window.claudio && typeof window.claudio.setView === "function") {
                window.claudio.setView("player");
              }
            }
          } catch (error) {
            song.classList.add("is-failed");
            track.blockedReason = error && error.message ? error.message : "Playback request failed";
            track.playState = "failed";
            song.dataset.track = JSON.stringify(track);
            statusEl.textContent = "failed";
            songButton.title = error && error.message ? error.message : "Playback request failed";
          } finally {
            applyPlaylistFilters(list);
            if (!song.classList.contains("is-failed")) {
              songButton.disabled = false;
            }
          }
        });
        list.appendChild(song);
      }

      function renderTrackPreview() {
        list.innerHTML = "";
        allTracks.slice(0, visibleCount).forEach(appendTrack);
        if (visibleCount < allTracks.length) {
          var more = document.createElement("li");
          more.className = "playlist-track playlist-track--more";
          var remaining = allTracks.length - visibleCount;
          more.innerHTML =
            '<button class="playlist-track__more" type="button">展开更多 · 还有 ' +
            remaining +
            " 首</button>";
          more.querySelector("button").addEventListener("click", function (event) {
            event.stopPropagation();
            visibleCount = Math.min(visibleCount + 10, allTracks.length);
            renderTrackPreview();
          });
          list.appendChild(more);
        }
        applyPlaylistFilters(list);
      }

      renderTrackPreview();
      applyPlaylistFilters(list);
      if (!allTracks.length) {
        list.innerHTML = '<li class="playlist-track is-empty">no songs found</li>';
      }
      list.dataset.loaded = "1";

      // Prefetch next playlist data via service worker
      if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
        var nextPlaylist = (playlists && playlists.items || []).find(function(p) {
          return p.encryptedId !== playlist.encryptedId && p.selected !== false;
        });
        if (nextPlaylist && nextPlaylist.encryptedId) {
          navigator.serviceWorker.controller.postMessage({
            type: "prefetch-playlist",
            url: "/api/playlist/tracks?id=" + encodeURIComponent(nextPlaylist.encryptedId) + "&limit=50",
          });
        }
      }
    } catch (_) {
      list.innerHTML = '<li class="playlist-track is-empty">songs unavailable</li>';
    }
  }

  try {
    var now = await api.now();
    if (nowTitleEl && now && now.title) nowTitleEl.textContent = now.title;
  if (nowSubEl && now)
    nowSubEl.textContent = [now.artist, now.album].filter(Boolean).join(" · ") || "not connected";
  } catch (_) {
    if (nowSubEl) nowSubEl.textContent = "server unreachable";
  }

  try {
    var memory = await api.memory();
    renderMemoryList(memoryPlaysEl, memory && memory.plays, function (item) {
      return {
        title: item.title || "Unknown track",
        sub: [item.artist, item.album].filter(Boolean).join(" · ") || "played",
      };
    });
    renderMemoryList(memoryFailedEl, memory && memory.blockedSongs, function (item) {
      return {
        title: item.title || "Unknown track",
        sub: item.reason || "playback failed",
      };
    });
  } catch (_) {
    if (memoryPlaysEl) memoryPlaysEl.innerHTML = '<li class="memory-item is-empty">memory unavailable</li>';
    if (memoryFailedEl) memoryFailedEl.innerHTML = '<li class="memory-item is-empty">memory unavailable</li>';
  }

  try {
    var stats = await api.stats();
    var grid = document.querySelector("[data-stats-grid]");
    var todayEl = document.querySelector("[data-stat-today-min]");
    var weekEl = document.querySelector("[data-stat-week-min]");
    var tracksEl = document.querySelector("[data-stat-tracks]");
    var topEl = document.querySelector("[data-stats-top]");
    if (grid) {
      grid.querySelectorAll(".stat").forEach(function (s) { s.classList.remove("is-loading"); });
    }
    if (todayEl) todayEl.textContent = (stats && stats.today && stats.today.minutes) ?? stats.todayMinutes ?? "0";
    if (weekEl) weekEl.textContent = (stats && stats.week && stats.week.minutes) ?? stats.weekMinutes ?? "0";
    if (tracksEl) {
      var tc = (stats && stats.today && stats.today.tracks) ?? (stats && stats.week && stats.week.tracks) ?? stats.tracks ?? 0;
      tracksEl.textContent = tc;
    }
    var topTracks = (stats && Array.isArray(stats.topTracks) && stats.topTracks.length)
      ? stats.topTracks
      : (stats && Array.isArray(stats.top) ? stats.top : []);
    if (topEl && topTracks.length) {
      topEl.innerHTML = "";
      topTracks.slice(0, 5).forEach(function (item, i) {
        var li = document.createElement("li");
        li.className = "top-item";
        li.innerHTML =
          '<span class="top-item__rank">' + (i + 1) + "</span>" +
          '<span class="top-item__title">' + (item.title || "Unknown track") + "</span>" +
          '<span class="top-item__artist">' + (item.artist || "") + "</span>" +
          '<span class="top-item__plays">' + (item.plays || 0) + "x</span>";
        topEl.appendChild(li);
      });
    } else if (topEl) {
      topEl.innerHTML = '<li class="top-item is-empty">no plays yet</li>';
    }
  } catch (_) {
    var grid2 = document.querySelector("[data-stats-grid]");
    if (grid2) grid2.querySelectorAll(".stat").forEach(function (s) { s.classList.remove("is-loading"); });
    var topEl2 = document.querySelector("[data-stats-top]");
    if (topEl2) topEl2.innerHTML = '<li class="top-item is-empty">stats unavailable</li>';
  }
}

function renderMemoryList(root, items, mapItem) {
  if (!root) return;
  root.innerHTML = "";
  var rows = Array.isArray(items) ? items.slice(0, 5) : [];
  if (!rows.length) {
    root.innerHTML = '<li class="memory-item is-empty">nothing yet</li>';
    return;
  }
  rows.forEach(function (item) {
    var mapped = mapItem(item);
    var li = document.createElement("li");
    li.className = "memory-item";
    li.innerHTML =
      '<span class="memory-item__title">' + (mapped.title || "") + "</span>" +
      '<span class="memory-item__sub">' + (mapped.sub || "") + "</span>";
    root.appendChild(li);
  });
}

// ============== chat composer ==============
(function chatComposer() {
  function init() {
    if (!window.claudio || !window.claudio.api) return false;
    var api = window.claudio.api;
    var form = document.querySelector("[data-chat-form]");
    var input = document.querySelector("[data-chat-input]");
    var thread = document.querySelector("[data-chat-thread]");
    var sendBtn = document.querySelector("[data-chat-send]");
    if (!form || !input || !thread) return true;

    var hintEl = thread.querySelector(".chat__hint");

    function clearHint() {
      if (hintEl && hintEl.parentNode) hintEl.parentNode.removeChild(hintEl);
      hintEl = null;
    }

    function normalizeChatRole(role, meta) {
      if (role === "user") return "user";
      if (role === "system" || meta === "offline") return "system";
      return "assistant";
    }

    function chatRoleLabel(role) {
      if (role === "user") return "You";
      if (role === "system") return "System";
      return "Claudio";
    }

    function pushBubble(role, text, meta) {
      clearHint();
      role = normalizeChatRole(role, meta);
      var bubble = document.createElement("div");
      bubble.className = "chat__bubble chat__bubble--" + role;
      var head = document.createElement("div");
      head.className = "chat__speaker";
      var avatar = document.createElement("span");
      avatar.className = "chat__avatar";
      avatar.textContent = role === "user" ? "Y" : role === "system" ? "!" : "C";
      var name = document.createElement("span");
      name.className = "chat__name";
      name.textContent = chatRoleLabel(role);
      head.appendChild(avatar);
      head.appendChild(name);
      bubble.appendChild(head);
      var body = document.createElement("p");
      body.className = "chat__text";
      body.textContent = text;
      bubble.appendChild(body);
      if (meta) {
        var metaEl = document.createElement("p");
        metaEl.className = "chat__meta";
        metaEl.textContent = meta;
        bubble.appendChild(metaEl);
      }
      // Add speak button for assistant messages
      if (role === "assistant" && text && text.length > 1) {
        var speakBtn = document.createElement("button");
        speakBtn.className = "chat__speak-btn";
        speakBtn.title = "Read aloud";
        speakBtn.innerHTML = "🔊";
        speakBtn.addEventListener("click", async function () {
          speakBtn.disabled = true;
          speakBtn.textContent = "⏳";
          try {
            var url = await api.tts(text);
            if (url) {
              var audio = new Audio(url);
              audio.play().catch(function () {});
            }
          } catch (_) {}
          speakBtn.disabled = false;
          speakBtn.innerHTML = "🔊";
        });
        bubble.appendChild(speakBtn);
      }
      thread.appendChild(bubble);
      while (thread.querySelectorAll(".chat__bubble").length > 30) {
        var oldest = thread.querySelector(".chat__bubble");
        if (!oldest) break;
        oldest.remove();
      }
      thread.scrollTop = thread.scrollHeight;
      return bubble;
    }

    function pushTyping(status) {
      clearHint();
      var bubble = document.createElement("div");
      bubble.className = "chat__bubble chat__bubble--assistant chat__bubble--typing";
      var html =
        '<div class="chat__speaker"><span class="chat__avatar">C</span><span class="chat__name">Claudio</span></div>' +
        '<span class="chat__dots"><i></i><i></i><i></i></span>';
      if (status) {
        html += '<span class="chat__typing-status">' + status + '</span>';
      }
      bubble.innerHTML = html;
      thread.appendChild(bubble);
      thread.scrollTop = thread.scrollHeight;
      return bubble;
    }

    function escapeHtml(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function pushRecommendationCard(rec) {
      if (!rec || !rec.title) return;
      clearHint();
      var bubble = document.createElement("div");
      bubble.className = "chat__bubble chat__bubble--assistant chat__bubble--rec";
      var head = document.createElement("div");
      head.className = "chat__speaker";
      head.innerHTML = '<span class="chat__avatar">C</span><span class="chat__name">Claudio</span>';
      bubble.appendChild(head);
      var card = document.createElement("div");
      card.className = "chat__rec-card";
      card.innerHTML =
        '<div class="chat__rec-head">推荐歌曲</div>' +
        '<div class="chat__rec-title">《' + escapeHtml(rec.title) + '》</div>' +
        (rec.artist ? '<div class="chat__rec-artist">' + escapeHtml(rec.artist) + '</div>' : '') +
        (rec.reason ? '<div class="chat__rec-reason">' + escapeHtml(rec.reason) + '</div>' : '');
      var recId = rec.encryptedId || rec.originalId || rec.id || "";
      if (recId || rec.query || rec.title) {
        var playBtn = document.createElement("button");
        playBtn.className = "chat__rec-play";
        playBtn.type = "button";
        playBtn.textContent = "▶ 播放这首歌";
        playBtn.addEventListener("click", async function () {
          playBtn.disabled = true;
          playBtn.textContent = "加载中…";
          var q = rec.title + (rec.artist ? " " + rec.artist : "");
          try {
            var track = {
              encryptedId: String(rec.encryptedId || rec.originalId || rec.id || ""),
              originalId: String(rec.originalId || rec.encryptedId || rec.id || ""),
              title: rec.title,
              artist: rec.artist || "",
              album: rec.album || "",
              query: q,
            };
            var result = track.originalId ? await api.play(track) : await api.play({ query: q });
            if (result && result.success === false) {
              pushBubble("system", "播放失败：" + (result.message || "unknown"), "error");
            } else {
              pushBubble("assistant", "正在播放：" + rec.title + (rec.artist ? " · " + rec.artist : ""), "NetEase");
              if (window.claudio && typeof window.claudio.refreshNow === "function") {
                window.claudio.refreshNow();
              }
            }
          } catch (err) {
            pushBubble("system", "播放请求失败", "error");
          }
          playBtn.disabled = false;
          playBtn.textContent = "▶ 播放这首歌";
        });
        card.appendChild(playBtn);
      }
      bubble.appendChild(card);
      thread.appendChild(bubble);
      thread.scrollTop = thread.scrollHeight;
      return bubble;
    }

    function pushSuggestionChips(chips) {
      if (!chips || !chips.length) return;
      var container = document.createElement("div");
      container.className = "chat__chips";
      chips.forEach(function (label) {
        var chip = document.createElement("button");
        chip.className = "chat__chip";
        chip.type = "button";
        chip.textContent = label;
        chip.addEventListener("click", function () {
          input.value = label;
          form.dispatchEvent(new Event("submit"));
        });
        container.appendChild(chip);
      });
      thread.appendChild(container);
      thread.scrollTop = thread.scrollHeight;
    }

    function setBusy(busy) {
      input.disabled = busy;
      if (sendBtn) sendBtn.disabled = busy;
      form.classList.toggle("is-busy", busy);
    }

    // Slash command: /play <query> → search via NetEase API, auto-play first result
    // list so render() picks up the new title/artist/duration instead of
    // showing whatever was there before.
    async function handlePlayCommand(query) {
      var typing = pushTyping();
      try {
        var resp = await api.search(query, 5);
        if (typing && typing.parentNode) typing.parentNode.removeChild(typing);
        var songs = (resp && resp.songs) ? resp.songs : [];
        if (!songs.length) {
          pushBubble("system", "No results for: " + query);
          return;
        }
        var song = songs[0];
        var track = { encryptedId: String(song.id), originalId: String(song.id), title: song.name, artist: song.artist, album: song.album };
        var result = await api.play(track);
        if (result && result.success === false) {
          pushBubble("system", "Play failed: " + (result.message || "unknown"), "error");
        } else {
          pushBubble("assistant",
            "▶ " + (song.name || query) + (song.artist ? " · " + song.artist : ""),
            "NetEase · /fav add 收藏");
        }
      } catch (err) {
        if (typing && typing.parentNode) typing.parentNode.removeChild(typing);
        pushBubble("system", "Search failed: " + (err && err.message || err), "error");
      }
    }

    // Slash command: /recent — show recent plays as clickable list
    async function handleRecentCommand() {
      var typing = pushTyping();
      try {
        var resp = await api.history();
        if (typing && typing.parentNode) typing.parentNode.removeChild(typing);
        var items = (resp && resp.items) || [];
        if (!items.length) {
          pushBubble("assistant", "还没有播放记录。试试 /play 晴天", "history");
          return;
        }
        clearHint();
        var bubble = document.createElement("div");
        bubble.className = "chat__bubble chat__bubble--assistant";
        bubble.innerHTML =
          '<div class="chat__speaker"><span class="chat__avatar">C</span><span class="chat__name">Claudio</span></div>' +
          '<p class="chat__text">最近播放 (' + items.length + ')</p>';
        var list = document.createElement("div");
        list.className = "chat__track-list";
        items.slice(0, 15).forEach(function (item) {
          var row = document.createElement("button");
          row.className = "chat__track-row";
          row.type = "button";
          row.innerHTML =
            '<span class="chat__track-title">' + (item.title || item.query || "?") + '</span>' +
            '<span class="chat__track-artist">' + (item.artist || "") + '</span>';
          row.addEventListener("click", function () {
            var q = item.query || item.title || "";
            if (q) { input.value = "/play " + q; form.dispatchEvent(new Event("submit")); }
          });
          list.appendChild(row);
        });
        bubble.appendChild(list);
        thread.appendChild(bubble);
        thread.scrollTop = thread.scrollHeight;
      } catch (err) {
        if (typing && typing.parentNode) typing.parentNode.removeChild(typing);
        pushBubble("system", "无法加载播放历史", "error");
      }
    }

    // Slash command: /fav — show favorites as clickable list
    async function handleFavCommand() {
      var typing = pushTyping();
      try {
        var resp = await api.favorites();
        if (typing && typing.parentNode) typing.parentNode.removeChild(typing);
        var items = (resp && resp.items) || [];
        if (!items.length) {
          pushBubble("assistant", "还没有收藏。播放时输入 /fav add 来收藏当前歌曲。", "favorites");
          return;
        }
        clearHint();
        var bubble = document.createElement("div");
        bubble.className = "chat__bubble chat__bubble--assistant";
        bubble.innerHTML =
          '<div class="chat__speaker"><span class="chat__avatar">C</span><span class="chat__name">Claudio</span></div>' +
          '<p class="chat__text">❤️ 收藏 (' + items.length + ')</p>';
        var list = document.createElement("div");
        list.className = "chat__track-list";
        items.slice(0, 20).forEach(function (item) {
          var row = document.createElement("button");
          row.className = "chat__track-row";
          row.type = "button";
          row.innerHTML =
            '<span class="chat__track-title">' + (item.title || item.query || "?") + '</span>' +
            '<span class="chat__track-artist">' + (item.artist || "") + '</span>';
          row.addEventListener("click", function () {
            var q = item.query || item.title || "";
            if (q) { input.value = "/play " + q; form.dispatchEvent(new Event("submit")); }
          });
          list.appendChild(row);
        });
        bubble.appendChild(list);
        thread.appendChild(bubble);
        thread.scrollTop = thread.scrollHeight;
      } catch (err) {
        if (typing && typing.parentNode) typing.parentNode.removeChild(typing);
        pushBubble("system", "无法加载收藏", "error");
      }
    }

    // Slash command: /fav add — favorite the currently playing track
    async function handleFavAddCommand() {
      var currentTitle = document.querySelector("[data-title]");
      var currentArtist = document.querySelector("[data-subtitle]");
      var title = currentTitle ? currentTitle.textContent.trim() : "";
      var artist = currentArtist ? currentArtist.textContent.trim() : "";
      if (!title || title === "Blinding Lights") {
        pushBubble("system", "当前没有在播放歌曲，无法收藏。", "favorites");
        return;
      }
      try {
        var resp = await api.addFavorite({ title: title, artist: artist, query: title });
        if (resp && resp.ok) {
          pushBubble("assistant", "❤️ 已收藏: " + title + (artist ? " · " + artist : ""), "favorites");
        } else {
          pushBubble("assistant", "已经在收藏里了: " + title, "favorites");
        }
      } catch (err) {
        pushBubble("system", "收藏失败", "error");
      }
    }

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text) return;

      // Slash-command: /play <query>
      var playMatch = text.match(/^__disabled_play_command__\s+(.+)$/i);
      if (playMatch) {
        pushBubble("user", text);
        input.value = "";
        setBusy(true);
        try { await handlePlayCommand(playMatch[1]); }
        finally { setBusy(false); input.focus(); }
        return;
      }

      // Slash-command: /recent
      if (/^__disabled_recent_command__$/i.test(text)) {
        pushBubble("user", text);
        input.value = "";
        setBusy(true);
        try { await handleRecentCommand(); }
        finally { setBusy(false); input.focus(); }
        return;
      }

      // Slash-command: /fav add
      if (/^__disabled_fav_add_command__$/i.test(text)) {
        pushBubble("user", text);
        input.value = "";
        setBusy(true);
        try { await handleFavAddCommand(); }
        finally { setBusy(false); input.focus(); }
        return;
      }

      // Slash-command: /fav
      if (/^__disabled_fav_command__$/i.test(text)) {
        pushBubble("user", text);
        input.value = "";
        setBusy(true);
        try { await handleFavCommand(); }
        finally { setBusy(false); input.focus(); }
        return;
      }

      pushBubble("user", text);
      input.value = "";
      setBusy(true);
      // Show relevant typing status based on intent
      var typingStatus = "正在思考…";
      if (/推荐|surprise|适合|来一首/.test(text)) typingStatus = "正在分析你的场景和歌单…";
      else if (/天气|weather|温度/.test(text)) typingStatus = "正在查询天气…";
      else if (/歌单|playlist|列表/.test(text)) typingStatus = "正在浏览你的歌单…";
      else if (/品味|taste|习惯|风格/.test(text)) typingStatus = "正在分析你的听歌品味…";
      var typing = pushTyping(typingStatus);
      var streamingBubble = null;
      var streamingText = "";

      // Fallback POST handler
      async function fallbackChat() {
        try {
          var reply = await api.chat(text, { source: "player" });
          if (typing && typing.parentNode) typing.parentNode.removeChild(typing);

          var rec = reply && (reply._recommendation || reply.recommendation);
          if (rec && rec.title) {
            pushRecommendationCard(rec);
          }

          var say = window.musicPlayerDemo && window.musicPlayerDemo.getChatReplyText
            ? window.musicPlayerDemo.getChatReplyText(reply)
            : (reply && (reply.reply || reply.say || reply.text || reply.message)) || "(no response)";
          var meta = window.musicPlayerDemo && window.musicPlayerDemo.getChatMetaText
            ? window.musicPlayerDemo.getChatMetaText(reply)
            : "";
          pushBubble("assistant", say, meta || null);
          if (window.claudio && typeof window.claudio.refreshNow === "function") {
            window.claudio.refreshNow();
          }

          showSuggestions(text);
        } catch (err) {
          if (typing && typing.parentNode) typing.parentNode.removeChild(typing);
          var msg = err && err.message
            ? "Couldn't reach Claudio: " + err.message
            : "Couldn't reach Claudio.";
          pushBubble("system", msg, "offline");

          // Queue for offline delivery
          if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
              type: "queue-chat",
              message: text,
            });
            if ("SyncManager" in window) {
              navigator.serviceWorker.ready.then(function(reg) {
                reg.sync.register("claudio-chat-flush").catch(function() {});
              });
            }
          }
        }
      }

      function showSuggestions(txt) {
        return;
        if (txt.indexOf("推荐") !== -1) {
          pushSuggestionChips(["再推荐一首", "这首歌什么风格", "加到收藏"]);
        } else if (txt.indexOf("天气") !== -1 || txt.indexOf("weather") !== -1) {
          pushSuggestionChips(["推荐一首适合现在的歌", "今天适合听什么"]);
        } else if (txt.indexOf("歌单") !== -1 || txt.indexOf("playlist") !== -1) {
          pushSuggestionChips(["推荐一首", "看看我的品味", "今天听什么"]);
        }
      }

      // Try WebSocket streaming first
      if (api.connectChatStream && api.sendChatStream) {
        var sentOverWs = false;
        var settledWs = false;
        api.connectChatStream(
          // onChunk
          function (chunk, index) {
            if (!streamingBubble) {
              if (typing && typing.parentNode) typing.parentNode.removeChild(typing);
              typing = null;
              streamingBubble = pushBubble("assistant", "");
            }
            streamingText += chunk;
            var textEl = streamingBubble.querySelector(".chat__text");
            if (textEl) textEl.textContent = streamingText;
            thread.scrollTop = thread.scrollHeight;
          },
          // onDone
          function (data) {
            settledWs = true;
            if (api.disconnectChatStream) api.disconnectChatStream();
            setBusy(false);
            input.focus();
            if (data.recommendation && data.recommendation.title) {
              pushRecommendationCard(data.recommendation);
            }
            if (window.claudio && typeof window.claudio.refreshNow === "function") {
              window.claudio.refreshNow();
            }
            if (streamingBubble && data.executedActions && data.executedActions.length) {
              var metaEl = document.createElement("p");
              metaEl.className = "chat__meta";
              metaEl.textContent = "ran " + data.executedActions.join(", ");
              streamingBubble.appendChild(metaEl);
            }
            showSuggestions(text);
          },
          // onError
          function () {
            if (settledWs) return;
            settledWs = true;
            if (typing && typing.parentNode) typing.parentNode.removeChild(typing);
            if (streamingBubble && streamingBubble.parentNode) streamingBubble.parentNode.removeChild(streamingBubble);
            fallbackChat();
            setBusy(false);
            input.focus();
          },
          // onState
          function (state, status) {
            if (state === "open" && !sentOverWs) {
              sentOverWs = true;
              api.sendChatStream(text);
            }
            if (state === "closed" && !settledWs && !sentOverWs) {
              settledWs = true;
              if (typing && typing.parentNode) typing.parentNode.removeChild(typing);
              fallbackChat().finally(function () {
                setBusy(false);
                input.focus();
              });
            }
            if (state === "typing" && typing) {
              var statusEl = typing.querySelector(".chat__typing-status");
              if (statusEl) statusEl.textContent = status || "thinking";
            }
          }
        );
        return;
      }

      // No WebSocket — use POST
      await fallbackChat();
      setBusy(false);
      input.focus();
    });

    // Server-pushed assistant messages via /stream
    if (api.live && typeof api.live.on === "function") {
      api.live.on(function (msg) {
        if (!msg || msg.type !== "chat") return;
        var role = msg.role === "user" ? "user" : "assistant";
        var text = msg.text || msg.say || "";
        if (!text) return;
        pushBubble(role, text, msg.reason || null);
      });
    }

    return true;
  }

  if (!init()) {
    window.addEventListener("DOMContentLoaded", init);
  }
})();

// ============== live stream bridge ==============
(function liveBridge() {
  function init() {
    if (!window.claudio || !window.claudio.api || !window.claudio.api.live) return false;
    var api = window.claudio.api;
    var dot = document.querySelector("[data-live-dot]");
    var nowTitleEl = document.querySelector("[data-now-title]");
    var nowSubEl = document.querySelector("[data-now-sub]");
    var planEl = document.querySelector("[data-plan-list]");
    var tasteEl = document.querySelector("[data-taste-tags]");

    api.live.onState(function (state) {
      if (!dot) return;
      dot.dataset.state = state;
      dot.title = "Stream: " + state;
    });

    api.live.on(function (msg) {
      if (!msg || typeof msg !== "object") return;
      switch (msg.type) {
        case "now":
          if (msg.track) {
            if (nowTitleEl && msg.track.title) nowTitleEl.textContent = msg.track.title;
            if (nowSubEl) {
              var sub = [msg.track.artist, msg.track.album].filter(Boolean).join(" · ");
              nowSubEl.textContent = sub || "not connected";
            }
          }
          break;
        case "plan":
          if (planEl && Array.isArray(msg.items)) {
            planEl.innerHTML = "";
            msg.items.forEach(function (item) {
              var li = document.createElement("li");
              li.className = "plan-item";
              li.innerHTML =
                '<span class="plan-item__time">' + (item.time || "") +
                '</span><span class="plan-item__label">' + (item.label || "") + "</span>";
              planEl.appendChild(li);
            });
          }
          break;
        case "taste":
          if (tasteEl && Array.isArray(msg.tags)) {
            tasteEl.innerHTML = "";
            msg.tags.forEach(function (tag) {
              var span = document.createElement("span");
              span.className = "taste-tag";
              span.textContent = tag;
              tasteEl.appendChild(span);
            });
          }
          break;
        case "dj-speak":
          if (msg.text && api.tts) {
            api.tts(msg.text).then(function (blobUrl) {
              if (!blobUrl) return;
              var audio = new Audio(blobUrl);
              audio.play().catch(function () {});
            }).catch(function () {});
            // Also show the text in chat
            if (typeof pushBubble === "function") {
              pushBubble("assistant", msg.text, "DJ播报");
            }
          }
          break;
      }
    });

    // Skip on file:// because EventSource only works over http(s).
    if (location.protocol !== "file:") api.live.connect();
    return true;
  }

  if (!init()) {
    window.addEventListener("DOMContentLoaded", init);
  }
})();

// ============== settings panel ==============
(function settingsPanel() {
  if (!window.claudio || !window.claudio.api) {
    // wait for api.js to load
    window.addEventListener("DOMContentLoaded", function () {
      if (window.claudio && window.claudio.api) wire();
    });
    return;
  }
  wire();

  function wire() {
    var api = window.claudio.api;
    var input = document.querySelector("[data-setting-api-base]");
    var hint = document.querySelector("[data-settings-hint]");
    var test = document.querySelector("[data-settings-test]");
    var status = document.querySelector("[data-settings-status]");
    var brainStatus = document.querySelector("[data-brain-status]");
    if (!input) return;

    input.value = api.getBase();
    updateHint();

    input.addEventListener("change", function () {
      api.setBase(input.value.trim());
      updateHint();
    });

    if (test) {
      test.addEventListener("click", async function () {
        status.textContent = "Testing...";
        status.className = "settings-status";
        try {
          var ok = await api.ping();
          status.textContent = ok ? "Connected" : "Server reachable but no /api/now";
          status.className = "settings-status " + (ok ? "is-ok" : "is-warn");
        } catch (e) {
          status.textContent = e && e.message ? e.message : "Failed";
          status.className = "settings-status is-err";
        }
      });
    }

    if (brainStatus && api.brainStatus) {
      api.brainStatus()
        .then(function (payload) {
          brainStatus.classList.toggle("is-ready", Boolean(payload && payload.configured));
          brainStatus.querySelector(".brain-status__text").textContent =
            payload && payload.configured
              ? "AICODEE ready · " + (payload.model || "model configured")
              : "AICODEE key not set · local control still works";
        })
        .catch(function () {
          brainStatus.classList.add("is-warn");
          brainStatus.querySelector(".brain-status__text").textContent = "Brain status unavailable";
        });
    }

    // Music login status in Settings
    var musicStatus = document.querySelector("[data-music-status]");
    var settingsLoginBtn = document.querySelector("[data-settings-login]");
    var settingsLogoutBtn = document.querySelector("[data-settings-logout]");

    function updateMusicStatus() {
      if (!musicStatus || !api.transportStatus) return;
      api.transportStatus()
        .then(function (payload) {
          if (!payload.available) {
            musicStatus.classList.remove("is-ready");
            musicStatus.classList.add("is-warn");
            musicStatus.querySelector(".brain-status__text").textContent =
              "Music API unavailable · " + (payload.message || "offline");
            if (settingsLoginBtn) settingsLoginBtn.hidden = true;
            if (settingsLogoutBtn) settingsLogoutBtn.hidden = true;
          } else if (!payload.loggedIn) {
            musicStatus.classList.remove("is-ready");
            musicStatus.classList.add("is-warn");
            musicStatus.querySelector(".brain-status__text").textContent =
              payload.message || "Not logged in";
            if (settingsLoginBtn) settingsLoginBtn.hidden = false;
            if (settingsLogoutBtn) settingsLogoutBtn.hidden = true;
          } else {
            musicStatus.classList.add("is-ready");
            musicStatus.classList.remove("is-warn");
            musicStatus.querySelector(".brain-status__text").textContent =
              "NetEase connected · logged in";
            if (settingsLoginBtn) settingsLoginBtn.hidden = true;
            if (settingsLogoutBtn) settingsLogoutBtn.hidden = false;
          }
        })
        .catch(function () {
          musicStatus.classList.remove("is-ready");
          musicStatus.classList.add("is-warn");
          musicStatus.querySelector(".brain-status__text").textContent = "Music status unavailable";
          if (settingsLoginBtn) settingsLoginBtn.hidden = true;
          if (settingsLogoutBtn) settingsLogoutBtn.hidden = true;
        });
    }

    updateMusicStatus();

    if (settingsLoginBtn) {
      settingsLoginBtn.addEventListener("click", async function () {
        settingsLoginBtn.disabled = true;
        try {
          var payload = await api.login();
          if (payload && (payload.qrCodeUrl || payload.qrImg)) {
            // Trigger the login modal from the player scope
            document.dispatchEvent(new CustomEvent("claudio:show-login", { detail: payload }));
          }
          updateMusicStatus();
        } catch (e) {
          status.textContent = e && e.message ? e.message : "Login failed";
        } finally {
          settingsLoginBtn.disabled = false;
        }
      });
    }

    if (settingsLogoutBtn) {
      settingsLogoutBtn.addEventListener("click", async function () {
        settingsLogoutBtn.disabled = true;
        try {
          await api.logout();
          updateMusicStatus();
          // Also refresh player UI
          if (window.claudio && typeof window.claudio.refreshNow === "function") {
            window.claudio.refreshNow();
          }
        } catch (e) {
          status.textContent = e && e.message ? e.message : "Logout failed";
        } finally {
          settingsLogoutBtn.disabled = false;
        }
      });
    }

    // Listen for login requests from Settings page
    document.addEventListener("claudio:show-login", function (e) {
      if (window.claudio && typeof window.claudio.showLogin === "function") {
        window.claudio.showLogin(e.detail);
      }
    });

    // User persona files editor
    (function userFilesEditor() {
      var listEl = document.querySelector("[data-user-files-list]");
      var editorEl = document.querySelector("[data-user-files-editor]");
      var editorNameEl = document.querySelector("[data-user-files-editor-name]");
      var editorTextEl = document.querySelector("[data-user-files-editor-text]");
      var saveBtn = document.querySelector("[data-user-files-save]");
      var cancelBtn = document.querySelector("[data-user-files-cancel]");
      var statusEl = document.querySelector("[data-user-files-status]");
      if (!listEl || !editorEl) return;

      var currentFile = null;

      function loadFileList() {
        api.userFiles().then(function (res) {
          var files = (res && res.files) ? res.files : [];
          listEl.innerHTML = "";
          files.forEach(function (f) {
            var row = document.createElement("div");
            row.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid #1a1d2a;";
            var nameSpan = document.createElement("span");
            nameSpan.textContent = f.name;
            nameSpan.style.cssText = "font-family:monospace; font-size:13px;";
            var editBtn = document.createElement("button");
            editBtn.textContent = "Edit";
            editBtn.className = "settings-button";
            editBtn.style.cssText = "padding:2px 10px; font-size:11px; margin-left:8px;";
            editBtn.addEventListener("click", function () { openEditor(f.name); });
            row.appendChild(nameSpan);
            row.appendChild(editBtn);
            listEl.appendChild(row);
          });
        }).catch(function () {});
      }

      function openEditor(name) {
        api.readUserFile(name).then(function (res) {
          if (!res || res.content == null) return;
          currentFile = name;
          editorNameEl.textContent = name;
          editorTextEl.value = res.content;
          editorEl.style.display = "block";
          statusEl.textContent = "";
          listEl.style.display = "none";
        }).catch(function () { statusEl.textContent = "Failed to load."; });
      }

      function closeEditor() {
        currentFile = null;
        editorEl.style.display = "none";
        listEl.style.display = "block";
        editorTextEl.value = "";
        statusEl.textContent = "";
      }

      saveBtn.addEventListener("click", function () {
        if (!currentFile) return;
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";
        api.saveUserFile(currentFile, editorTextEl.value).then(function (res) {
          saveBtn.disabled = false;
          saveBtn.textContent = "Save";
          if (res && res.ok) {
            statusEl.textContent = "Saved successfully!";
            setTimeout(function () { statusEl.textContent = ""; }, 2000);
          } else {
            statusEl.textContent = "Save failed.";
          }
        }).catch(function () {
          saveBtn.disabled = false;
          saveBtn.textContent = "Save";
          statusEl.textContent = "Network error.";
        });
      });

      cancelBtn.addEventListener("click", closeEditor);

      loadFileList();
    })();

    // UPnP speaker panel
    (function upnpPanel() {
      var statusEl = document.querySelector("[data-upnp-status]");
      var scanBtn = document.querySelector("[data-upnp-scan]");
      var disconnectBtn = document.querySelector("[data-upnp-disconnect]");
      var devicesEl = document.querySelector("[data-upnp-devices]");
      if (!scanBtn || !devicesEl) return;

      function updateStatus() {
        api.upnpStatus().then(function (s) {
          if (s && s.connected) {
            statusEl.textContent = "Connected: " + ((s.device && s.device.name) || "Speaker");
            disconnectBtn.style.display = "inline-block";
            scanBtn.textContent = "Rescan";
          } else {
            statusEl.textContent = "Not connected";
            disconnectBtn.style.display = "none";
            scanBtn.textContent = "Scan for speakers";
          }
        }).catch(function () {});
      }

      scanBtn.addEventListener("click", async function () {
        scanBtn.disabled = true;
        scanBtn.textContent = "Scanning...";
        devicesEl.innerHTML = '<div style="font-size:12px; color:#777;">Searching for UPnP renderers...</div>';
        try {
          var res = await api.upnpDevices();
          var devices = (res && res.devices) ? res.devices : [];
          devicesEl.innerHTML = "";
          if (!devices.length) {
            devicesEl.innerHTML = '<div style="font-size:12px; color:#777;">No UPnP speakers found.</div>';
          } else {
            devices.forEach(function (d) {
              var row = document.createElement("div");
              row.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid #1a1d2a;";
              row.innerHTML = '<span style="font-size:13px;">' + d.name + '</span>';
              var btn = document.createElement("button");
              btn.textContent = "Connect";
              btn.className = "settings-button";
              btn.style.cssText = "padding:2px 10px; font-size:11px;";
              btn.addEventListener("click", async function () {
                btn.disabled = true;
                btn.textContent = "Connecting...";
                try {
                  var cr = await api.upnpConnect(d);
                  if (cr && cr.ok) {
                    updateStatus();
                  }
                } catch (_) {}
                btn.disabled = false;
                btn.textContent = "Connect";
              });
              row.appendChild(btn);
              devicesEl.appendChild(row);
            });
          }
        } catch (_) {
          devicesEl.innerHTML = '<div style="font-size:12px; color:#e74c3c;">Scan failed.</div>';
        }
        scanBtn.disabled = false;
        scanBtn.textContent = "Rescan";
      });

      disconnectBtn.addEventListener("click", async function () {
        disconnectBtn.disabled = true;
        try { await api.upnpDisconnect(); } catch (_) {}
        updateStatus();
        disconnectBtn.disabled = false;
      });

      updateStatus();
    })();

    function updateHint() {
      if (!hint) return;
      var base = api.getBase();
      hint.textContent = base ? "Pointing at " + base : "Same origin (default)";
    }
  }
})();
