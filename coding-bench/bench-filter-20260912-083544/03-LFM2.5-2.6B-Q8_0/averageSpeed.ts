// averageSpeed.ts - Compute average speed and validate positive numbers

export function averageSpeed(distanceKm: number, hours: number): number {
  // distance / hours, rounded to 2 decimals
  return Math.round((distanceKm / hours) * 100) / 100;
}

export function isPositiveNumber(x: unknown): boolean {
  // Check if x is a number and greater than 0
  return typeof x === "number" && x > 0;
}

// Self-test: verify averageSpeed function works correctly
console.log("Self-test: averageSpeed(240, 5) =", averageSpeed(240, 5));
console.log("Self-test: averageSpeed(100, 2) =", averageSpeed(100, 2));
console.log("Self-test: isPositiveNumber(5) =", isPositiveNumber(5));
console.log("Self-test: isPositiveNumber(-1) =", isPositiveNumber(-1));
console.log("Self-test: isPositiveNumber(0) =", isPositiveNumber(0));
console.log("Self-test: isPositiveNumber('5') =", isPositiveNumber('5'));
console.log("Self-test: isPositiveNumber(null) =", isPositiveNumber(null));
console.log("Self-test: isPositiveNumber(undefined) =", isPositiveNumber(undefined));

