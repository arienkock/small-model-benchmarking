// averageSpeed.ts - CommonJS module
module.exports.averageSpeed = function(distanceKm: number, hours: number) {
  // distance / hours, rounded to 2 decimals
  return Math.round((distanceKm / hours) * 100) / 100;
};

module.exports.isPositiveNumber = function(x: unknown): boolean {
  // Check if x is a number and greater than 0
  return typeof x === "number" && x > 0;
};

// Self-test
if (import.meta.main) {
  console.log("Running self-tests...");
  console.log("averageSpeed(240, 5) =", averageSpeed(240, 5), "expected: 48");
  console.log("isPositiveNumber(240) =", isPositiveNumber(240), "expected: true");
  console.log("isPositiveNumber(-5) =", isPositiveNumber(-5), "expected: false");
  console.log("isPositiveNumber(0) =", isPositiveNumber(0), "expected: false");
  console.log("isPositiveNumber('abc') =", isPositiveNumber('abc'), "expected: false");
  const allPassed = 
    averageSpeed(240, 5) === 48 &&
    isPositiveNumber(240) === true &&
    isPositiveNumber(-5) === false &&
    isPositiveNumber(0) === false &&
    isPositiveNumber('abc') === false;
  console.log("All tests passed!" === allPassed ? "SUCCESS" : "FAILURE");
  process.exit(allPassed ? 0 : 1);
}
