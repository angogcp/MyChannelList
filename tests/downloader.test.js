const assert = require("assert");
const test = require("node:test");
const { resolveQualityPreset } = require("../lib/downloader");

test("resolveQualityPreset defaults to best mp4 when quality is empty", () => {
  const preset = resolveQualityPreset("video", "");
  assert.strictEqual(preset.format, "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/bv*+ba/b");
  assert.strictEqual(preset.formatSort, undefined);
});

test("resolveQualityPreset sets formatSort for resolution presets without restrictive format filters", () => {
  const p720 = resolveQualityPreset("video", "720p");
  assert.strictEqual(p720.format, "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/bv*+ba/b");
  assert.strictEqual(p720.formatSort, "res:720");

  const p1080 = resolveQualityPreset("video", "1080p");
  assert.strictEqual(p1080.format, "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/bv*+ba/b");
  assert.strictEqual(p1080.formatSort, "res:1080");

  const p480 = resolveQualityPreset("video", "480p");
  assert.strictEqual(p480.formatSort, "res:480");
});

test("resolveQualityPreset handles mp3 quality presets", () => {
  const mp3Best = resolveQualityPreset("mp3", "best");
  assert.strictEqual(mp3Best.audioQuality, "0");

  const mp3320 = resolveQualityPreset("mp3", "320k");
  assert.strictEqual(mp3320.audioQuality, "320K");
});

test("resolveQualityPreset throws on invalid options", () => {
  assert.throws(() => resolveQualityPreset("video", "unknown"), /Unsupported video quality/);
  assert.throws(() => resolveQualityPreset("mp3", "unknown"), /Unsupported MP3 quality/);
});
