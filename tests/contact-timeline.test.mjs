import test from "node:test";
import assert from "node:assert/strict";
import { contactTimelinePoints, timelineDateLabel } from "../app/contact-timeline.ts";

test("conversation and life event appear separately, anchored to their own dates", () => {
  const points = contactTimelinePoints([
    { id: "visited", body: "Kyle visited his brother last weekend", date: "2026-11-10", timeStart: "2026-11-07" },
  ], [{ id: "g1", title: "Dinner with Kyle", date: "2026-11-10" }]);
  assert.deepEqual(points.map(point => [point.kind, point.date]), [
    ["conversation", "2026-11-10"], ["event", "2026-11-07"],
  ]);
});

test("timeline event without inferred date falls back to the note date", () => {
  const points = contactTimelinePoints([{ id: "event", body: "Won a prize", date: "2026-10-01" }], []);
  assert.equal(points[0].date, "2026-10-01");
  assert.equal(timelineDateLabel(points[0].date), "Oct 1, 2026");
});

test("conversations sort before events on same date and ignore invalid conversation dates", () => {
  const points = contactTimelinePoints([{ id: "e", body: "Moved", date: "2026-10-09" }], [
    { id: "bad", title: "Unspecified", date: "yesterday" },
    { id: "g", title: "Coffee", date: "2026-10-09" },
  ]);
  assert.deepEqual(points.map(point => point.key), ["talk:g", "event:e"]);
});
