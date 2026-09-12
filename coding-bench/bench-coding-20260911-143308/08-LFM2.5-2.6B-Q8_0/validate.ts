import { validateEntry } from "./validateEntry";

// Simple test runner
async function runTests() {
    console.log("Running validation tests...\n");

    // Test 1: Valid entry
    const result1 = validateEntry("Alice", "Hello, world!");
    if (result1.ok) {
        console.log("✓ Test 1 passed: Valid entry accepted");
    } else {
        console.log("✗ Test 1 failed: Valid entry rejected", result1.error);
    }

    // Test 2: Name too long (41 chars)
    const result2 = validateEntry("A".repeat(41), "Message");
    if (!result2.ok) {
        console.log("✓ Test 2 passed: Name too long rejected");
    } else {
        console.log("✗ Test 2 failed: Name too long entry accepted", result2.error);
    }

    // Test 3: Name empty
    const result3 = validateEntry("", "Message");
    if (!result3.ok) {
        console.log("✓ Test 3 passed: Empty name rejected");
    } else {
        console.log("✗ Test 3 failed: Empty name entry accepted", result3.error);
    }

    // Test 4: Message too long (201 chars)
    const longMsg = "A".repeat(201);
    const result4 = validateEntry("Bob", longMsg);
    if (!result4.ok) {
        console.log("✓ Test 4 passed: Message too long rejected");
    } else {
        console.log("✗ Test 4 failed: Message too long entry accepted", result4.error);
    }

    // Test 5: Message empty
    const result5 = validateEntry("Charlie", "");
    if (!result5.ok) {
        console.log("✓ Test 5 passed: Empty message rejected");
    } else {
        console.log("✗ Test 5 failed: Empty message entry accepted", result5.error);
    }

    // Test 6: Both name and message valid
    const result6 = validateEntry("Dana", "This is a valid message");
    if (result6.ok) {
        console.log("✓ Test 6 passed: Valid entry with both fields accepted");
    } else {
        console.log("✗ Test 6 failed: Valid entry rejected", result6.error);
    }

    console.log("\nAll tests completed.");
}

runTests();
