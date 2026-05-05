const FAILURE_REASON_LABELS = {
  "no-license": "版权/授权不足，当前账号或端侧不能播放",
  "paid-or-vip": "需要 VIP 或单曲购买",
  "player-backend": "播放器后端不可用，请检查 mpv / ncm-cli 播放器配置",
  "queue-empty": "播放队列为空",
  "playback-not-confirmed": "已发送播放请求，但未确认播放器切到这首歌",
  "playback-failed": "播放请求失败",
};

function classifyPlaybackFailure(payload = {}) {
  const subCode = Number(payload.subCode ?? payload.data?.subCode ?? payload.failData?.subCode);
  if (subCode === 10003) return "no-license";
  if (subCode === 10004) return "paid-or-vip";

  const message = String(payload.message ?? payload.detail ?? payload.error ?? payload.reason ?? payload ?? "");
  if (/mpv|player|播放器|not found|not recognized|ENOENT/i.test(message)) {
    return "player-backend";
  }
  if (/queue.*empty|empty queue|队列.*空|播放列表为空/i.test(message)) {
    return "queue-empty";
  }
  if (/not.?confirm|确认|not.?playing|state/i.test(message)) {
    return "playback-not-confirmed";
  }
  return "playback-failed";
}

function getFailureReasonLabel(reason) {
  return FAILURE_REASON_LABELS[reason] || FAILURE_REASON_LABELS["playback-failed"];
}

function normalizeComparableText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isMatchingPlaybackTrack(now = {}, item = {}) {
  const track = now.track ?? now.state?.track ?? now.state ?? {};
  const ids = [
    track.id,
    track.songId,
    track.originalId,
    track.encryptedId,
  ].filter(Boolean).map(String);
  const requestedIds = [item.encryptedId, item.originalId, item.id].filter(Boolean).map(String);

  if (requestedIds.some((id) => ids.includes(id))) {
    return true;
  }

  const title = normalizeComparableText(track.title ?? track.name);
  const artist = normalizeComparableText(track.artist ?? track.subtitle ?? track.author);
  const requestedTitle = normalizeComparableText(item.title ?? item.name);
  const requestedArtist = normalizeComparableText(item.artist);

  return Boolean(
    title &&
      requestedTitle &&
      title === requestedTitle &&
      (!requestedArtist || !artist || artist.includes(requestedArtist) || requestedArtist.includes(artist))
  );
}

module.exports = {
  classifyPlaybackFailure,
  getFailureReasonLabel,
  isMatchingPlaybackTrack,
};
