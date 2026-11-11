import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTemporalAnnotations, sanitizeTemporalPayload, temporalHint, timelineSortDate, validDate,
} from "../app/temporal-facts.ts";

test("the extra pass keeps a brother relationship on the profile without inventing a date", () => {
  const facts = [{ name: "Kyle", detail: "Has a brother two years older who lives in SF.", factType: "timeline" }];
  const [result] = applyTemporalAnnotations({ items: [{ index: 0, nature: "event", time: {
    expression: "two years older", start: "2024-11-10", end: null, precision: "day", certainty: "exact",
  } }] }, facts, "2026-11-10", facts[0].detail);
  assert.equal(result.factType, "profile");
  assert.equal(result.timeStart, undefined);
  assert.equal(temporalHint(result), null);
});

test("the gathering anchors last weekend even when the local model guesses an incorrect date", () => {
  const facts = [{ detail: "Visited his brother last weekend.", factType: "profile" }];
  const [result] = applyTemporalAnnotations({ items: [{ index: 0, nature: "event", time: {
    expression: "last weekend", start: "2026-11-01", end: "2026-11-02", precision: "weekend", certainty: "exact",
  } }] }, facts, "2026-11-10", "Kyle visited his brother last weekend.");
  assert.equal(result.factType, "timeline");
  assert.deepEqual([result.timeStart, result.timeEnd], ["2026-11-07", "2026-11-08"]);
  assert.equal(result.timeCertainty, "tentative");
  assert.match(temporalHint(result), /Last weekend .*~Nov 7, 2026 – Nov 8, 2026/);
});

test("an enduring current job can have a since-date while remaining a profile fact", () => {
  const facts = [{ detail: "Has worked at Google since 2022.", factType: "timeline" }];
  const [result] = applyTemporalAnnotations({ items: [{ index: 0, nature: "current_state", time: {
    expression: "since 2022", start: "2022-01-01", end: null, precision: "year", certainty: "tentative",
  } }] }, facts, "2026-11-10", facts[0].detail);
  assert.equal(result.factType, "profile");
  assert.equal(result.timeStart, "2022-01-01");
  assert.match(temporalHint(result), /Since 2022 · ~2022/);
});

test("a planned activity is a timeline item even without a firm date", () => {
  const facts = [{ detail: "Plans to run a marathon soon.", factType: "profile" }];
  const [result] = applyTemporalAnnotations({ items: [{ index: 0, nature: "planned", time: {
    expression: "soon", start: null, end: null, precision: "approximate", certainty: "tentative",
  } }] }, facts, "2026-11-10", facts[0].detail);
  assert.equal(result.factType, "timeline");
  assert.equal(result.timeStart, null);
  assert.match(temporalHint(result), /Soon · date unconfirmed/);
});

test("dates not grounded in the note and impossible calendar dates are ignored", () => {
  const detail = "Visited his brother on February 28, 2026.";
  const [unearned] = applyTemporalAnnotations({ items: [{ index: 0, nature: "event", time: {
    expression: "in 2030", start: "2030-01-01", precision: "year", certainty: "exact",
  } }] }, [{ detail, factType: "timeline" }], "2026-11-10", detail);
  assert.equal(unearned.timeStart, undefined);
  const [impossible] = applyTemporalAnnotations({ items: [{ index: 0, nature: "event", time: {
    expression: "February 28, 2026", start: "2026-02-30", precision: "day", certainty: "exact",
  } }] }, [{ detail, factType: "timeline" }], "2026-11-10", detail);
  assert.equal(impossible.timeStart, null);
  assert.equal(validDate("2026-02-30"), false);
});

test("only indexed existing facts can be annotated, and legacy facts sort by the gathering date", () => {
  const facts = [{ detail: "Enjoys violin.", factType: "profile" }];
  const result = applyTemporalAnnotations({ items: [{ index: 9, nature: "event" }] }, facts, "2026-11-10", facts[0].detail);
  assert.deepEqual(result, facts);
  assert.equal(timelineSortDate({ date: "2026-11-10", timeStart: null }), "2026-11-10");
  assert.equal(timelineSortDate({ date: "2026-11-10", timeStart: "2026-10-03" }), "2026-10-03");
});

test("server persistence revalidates temporal dates and leaves undated facts intact", () => {
  const payload = {
    temporalNature: "event", timeExpression: "yesterday", timeStart: "1999-01-01", timeEnd: null,
    timePrecision: "day", timeCertainty: "exact",
  };
  const result = sanitizeTemporalPayload(payload, "Visited his brother yesterday.", "Visited his brother yesterday.", "2026-11-10");
  assert.equal(result.timeStart, "2026-11-09");
  assert.equal(result.temporalNature, "event");
  assert.equal(sanitizeTemporalPayload({ ...payload, timeExpression: "two years older" }, "Has a brother two years older.", "Has a brother two years older.", "2026-11-10").timeStart, undefined);
});
