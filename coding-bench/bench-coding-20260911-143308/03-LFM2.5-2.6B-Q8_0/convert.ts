// Temperature conversion functions

const UNITS = {
  C: "Celsius",
  F: "Fahrenheit",
  K: "Kelvin"
};

/**
 * Convert a temperature value from one unit to another.
 * @param value - The temperature value to convert
 * @param from - The source unit (C, F, or K)
 * @param to - The target unit (C, F, or K)
 * @returns The converted temperature value
 */
function convertTemp(value: number, from: string, to: string): number {
  if (!UNITS[from] || !UNITS[to]) {
    throw new Error("Unknown unit");
  }

  // Convert to Celsius first as intermediate
  let celsius: number;
  if (from === "C") {
    celsius = value;
  } else if (from === "F") {
    celsius = (value - 32) * 5 / 9;
  } else if (from === "K") {
    celsius = value - 273.15;
  } else {
    throw new Error("Unknown unit");
  }

  // Convert from Celsius to target unit
  if (to === "C") {
    return celsius;
  } else if (to === "F") {
    return celsius * 9 / 5 + 32;
  } else if (to === "K") {
    return celsius + 273.15;
  } else {
    throw new Error("Unknown unit");
  }
}

/**
 * Check if a unit is supported.
 * @param unit - The unit to check
 * @returns True if the unit is supported, false otherwise
 */
function isSupportedUnit(unit: string): boolean {
  return Object.keys(UNITS).includes(unit);
}

// Export functions for use in other modules
export { convertTemp, isSupportedUnit };
