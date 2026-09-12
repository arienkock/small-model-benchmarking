const { mergeMessages } = require("./chat.js");

function assertEqual(actual, expected, message) {
  if (!Array.isArray(actual) || actual.length !== expected.length) {
    console.error(`Assertion failed [${message}]: expected ${expected.length} elements, got ${actual.length}`);
    console.error(`  expected: ${JSON.stringify(expected)}`);
    console.error(`  actual:   ${JSON.stringify(actual)}`);
    process.exitCode = 1;
    return;
  }
  for (let i = 0; i < actual.length; i++) {
    if (actual[i].id !== expected[i].id || actual[i].user !== expected[i].user || actual[i].text !== expected[i].text) {
      console.error(`Assertion failed [${message}[${i}]]`);
      console.error(`  expected: ${JSON.stringify(expected[i])}`);
      console.error(`  actual:   ${JSON.stringify(actual[i])}`);
      process.exitCode = 1;
      return;
    }
  }
}

// Test 1: No duplicates - merge incoming with existing
const existing1 = [{ id: 2, user: "user2", text: "text2" }];
const incoming1 = [{ id: 1, user: "user1", text: "text1" }, { id: 3, user: "user1", text: "text3" }];
const result1 = mergeMessages(existing1, incoming1);
assertEqual(result1, [
  { id: 1, user: "user1", text: "text1" },
  { id: 2, user: "user2", text: "text2" },
  { id: 3, user: "user1", text: "text3" },
], "Test 1: merge with no duplicates");

// Test 2: Duplicate id in both existing and incoming - incoming processed first
const existing2 = [{ id: 2, user: "user2", text: "text2" }];
const incoming2 = [{ id: 2, user: "user1", text: "text1" }, { id: 4, user: "user2", text: "text4" }];
const result2 = mergeMessages(existing2, incoming2);
assertEqual(result2, [
  { id: 2, user: "user1", text: "text1" },
  { id: 4, user: "user2", text: "text4" },
], "Test 2: duplicate id in both lists");

// Test 3: Duplicate id in incoming only
const result3 = mergeMessages([], [{ id: 1, user: "user1", text: "text1" }, { id: 1, user: "user1", text: "text1b" }]);
assertEqual(result3, [{ id: 1, user: "user1", text: "text1" }], "Test 3: duplicate id in incoming only");

// Test 4: Result always sorted by id ascending
const existing4 = [{ id: 10, user: "u10", text: "t10" }, { id: 5, user: "u5", text: "t5" }];
const incoming4 = [{ id: 1, user: "u1", text: "t1" }, { id: 7, user: "u7", text: "t7" }];
const result4 = mergeMessages(existing4, incoming4);
assertEqual(result4, [
  { id: 1, user: "u1", text: "t1" },
  { id: 5, user: "u5", text: "t5" },
  { id: 7, user: "u7", text: "t7" },
  { id: 10, user: "u10", text: "t10" },
], "Test 4: result always sorted by id");

console.log("All tests passed");
process.exit(0);
