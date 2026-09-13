export function averageSpeed(distanceKm: number, hours: number): number {
  if (hours <= 0) {
    throw new Error("hours must be greater than 0");
  }
  return Math.round((distanceKm / hours) * 100) / 100;
}

export function isPositiveNumber(x: unknown): boolean {
  if (typeof x === "number" && Number.isFinite(x) && x > 0) {
    return true;
  }
  return false;
}

// Simple self-test when run directly
try {
  const result = averageSpeed(240, 5);
  console.log("averageSpeed(240, 5) =", result);
  // test rounding to 2 decimals
  const result2 = averageSpeed(100, 3); // 33.333... -> 33.33
  console.log("averageSpeed(100, 3) =", result2);
  // test isPositiveNumber
  console.log("isPositiveNumber(5) =", isPositiveNumber(5));
  console.log("isPositiveNumber(-1) =", isPositiveNumber(-1));
  console.log("isPositiveNumber('hello') =", isPositiveNumber('hello'));
  console.log("isPositiveNumber(0) =", isPositiveNumber(0));
  console.log("isPositiveNumber(null) =", isPositiveNumber(null));
  console.log("isPositiveNumber(undefined) =", isPositiveNumber(undefined));
} catch (err) {
  console.error("Self-test error:", err);
}
