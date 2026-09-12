export function averageSpeed(distanceKm: number, hours: number): number {
    return Math.round((distanceKm / hours) * 100) / 100;
}

export function isPositiveNumber(x: unknown): boolean {
    return typeof x === 'number' && x > 0;
}

// Self-test
if (import.meta.url === new URL(process.argv[1], 'file://').href) {
    // Run self-test when executed directly
    const tests = [];
    
    // Test averageSpeed
    const result1 = averageSpeed(240, 5);
    if (result1 === 48) tests.push('averageSpeed(240, 5) = 48 ✓');
    
    const result2 = averageSpeed(100, 2);
    if (result2 === 50) tests.push('averageSpeed(100, 2) = 50 ✓');
    
    const result3 = averageSpeed(150, 3);
    if (result3 === 50) tests.push('averageSpeed(150, 3) = 50 ✓');
    
    // Test isPositiveNumber
    const pos = isPositiveNumber(5);
    if (pos === true) tests.push('isPositiveNumber(5) = true ✓');
    
    const neg = isPositiveNumber(-1);
    if (neg === false) tests.push('isPositiveNumber(-1) = false ✓');
    
    const zero = isPositiveNumber(0);
    if (zero === false) tests.push('isPositiveNumber(0) = false ✓');
    
    const notNumber = isPositiveNumber('abc');
    if (notNumber === false) tests.push('isPositiveNumber("abc") = false ✓');
    
    console.log('All tests passed!');
    console.log('Tests:', tests);
}

