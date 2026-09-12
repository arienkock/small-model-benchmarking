import { validateEntry } from './validateEntry';

// Simple test runner
async function runTests() {
    console.log('Running validation tests...\n');

    // Test 1: Valid entry
    const result1 = validateEntry('Alice', 'Hello world!');
    if (!result1.ok) {
        console.error('Test 1 FAILED: Valid entry rejected');
        console.error('Result:', JSON.stringify(result1, null, 2));
        process.exit(1);
    }
    console.log('Test 1 PASSED: Valid entry accepted');

    // Test 2: Name too short
    const result2 = validateEntry('A', 'Message');
    if (result2.ok) {
        console.error('Test 2 FAILED: Short name accepted');
        process.exit(1);
    }
    console.log('Test 2 PASSED: Short name rejected');

    // Test 3: Name too long
    const result3 = validateEntry('A'.repeat(41), 'Message');
    if (result3.ok) {
        console.error('Test 3 FAILED: Long name accepted');
        process.exit(1);
    }
    console.log('Test 3 PASSED: Long name rejected');

    // Test 4: Empty name
    const result4 = validateEntry('', 'Message');
    if (result4.ok) {
        console.error('Test 4 FAILED: Empty name accepted');
        process.exit(1);
    }
    console.log('Test 4 PASSED: Empty name rejected');

    // Test 5: Empty message
    const result5 = validateEntry('Bob', '');
    if (result5.ok) {
        console.error('Test 5 FAILED: Empty message accepted');
        process.exit(1);
    }
    console.log('Test 5 PASSED: Empty message rejected');

    // Test 6: Message too long
    const result6 = validateEntry('Charlie', 'A'.repeat(201));
    if (result6.ok) {
        console.error('Test 6 FAILED: Long message accepted');
        process.exit(1);
    }
    console.log('Test 6 PASSED: Long message rejected');

    // Test 7: Both name and message valid
    const result7 = validateEntry('Dave', 'This is a valid message.');
    if (!result7.ok) {
        console.error('Test 7 FAILED: Valid entry rejected');
        process.exit(1);
    }
    console.log('Test 7 PASSED: Valid entry with both fields');

    console.log('\nAll tests passed!');
}

runTests();
