import test from "node:test";
import assert from "node:assert/strict";
import { explicitRelationshipAnchors, preserveRelationshipDirections } from "../app/relationship-anchors.ts";
import { EXTRACTION_FIXTURES } from "../app/extraction-regression.ts";

const note = EXTRACTION_FIXTURES.find(item => item.id === "named_relatives").note;
const memory = (name, detail) => ({ name, detail, factType: "profile", quote: "" });

test("source establishes directional named family relationships", () => {
  assert.deepEqual(explicitRelationshipAnchors(note), [
    { owner: "Kyle", relation: "older brother", relative: "Francis" },
    { owner: "Kyle", relation: "younger sister", relative: "Emily" },
  ]);
});

test("later model passes cannot reverse named siblings", () => {
  const candidates = [
    memory("Kyle", "Has an older brother named Francis who lives in SF"),
    memory("Francis", "Has an older brother named Kyle who lives in SF"),
    memory("Emily", "Has a younger sister named Kyle who just moved to Seattle"),
    memory("Emily", "Moved to Seattle"),
  ];
  assert.deepEqual(preserveRelationshipDirections(candidates, note), [candidates[0], candidates[3]]);
});

test("unknown or independently stated relationships are not guessed or erased", () => {
  const candidate = memory("Francis", "Has a younger sister named Emily");
  assert.deepEqual(preserveRelationshipDirections([candidate], note), [candidate]);
  const reciprocal = "Kyle has an older brother named Francis. Francis has an older brother named Kyle.";
  assert.deepEqual(preserveRelationshipDirections([memory("Francis", "Has an older brother named Kyle")], reciprocal).length, 1);
});
