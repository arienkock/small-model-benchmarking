// Temperature conversion functions

/**
 * Convert temperature between Celsius, Fahrenheit, and Kelvin.
 * @param value - The temperature value to convert
 * @param from - The source unit ('C', 'F', or 'K')
 * @param to - The target unit ('C', 'F', or 'K')
 * @returns The converted temperature value
 */
export function convertTemp(value: number, from: string, to: string): number {
  if (from === to) {
    return value;
  }

  // Convert from source unit to Celsius first
  let tempC: number;
  if (from === 'C') {
    tempC = value;
  } else if (from === 'F') {
    tempC = (value - 32) * 5 / 9;
  } else if (from === 'K') {
    tempC = value - 273.15;
  } else {
    throw new Error('Unknown unit');
  }

  // Convert from Celsius to target unit
  if (to === 'C') {
    return tempC;
  } else if (to === 'F') {
    return (tempC * 9 / 5) + 32;
  } else if (to === 'K') {
    return tempC + 273.15;
  } else {
    throw new Error('Unknown unit');
  }
}

/**
 * Check if a unit is supported (C, F, or K).
 * @param unit - The unit to check
 * @returns true if the unit is supported, false otherwise
 */
export function isSupportedUnit(unit: string): boolean {
  return unit === 'C' || unit === 'F' || unit === 'K';
}
