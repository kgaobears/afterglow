import test from "node:test";
import assert from "node:assert/strict";
import { parseMemories } from "../app/memory-parser.ts";
import { inspectSourceMemories } from "../app/source-verification.ts";

test("misplaced facts with empty details are rejected before review", () => {
  const malformed = { memories: [
    { name: "Kyle has a brother", detail: "", quote: "", factType: "profile" },
    { name: "His brother lives in San Francisco", detail: "", quote: "" },
    { name: "He visited his brother last weekend", detail: "", quote: "" },
  ] };
  assert.deepEqual(parseMemories(malformed), []);
});

test("valid atomic notes survive even if neighboring rows are malformed", () => {
  const parsed = parseMemories({ memories: [
    { name: "Kyle has a brother", detail: "" },
    { name: "Kyle", detail: "Visited his brother last weekend", quote: "" },
  ] });
  assert.deepEqual(parsed.map(note => [note.name, note.detail]), [["Kyle", "Visited his brother last weekend"]]);
  assert.equal(inspectSourceMemories("Kyle visited his brother last weekend", parsed, [parsed[0]])[0].status, "verified");
});
