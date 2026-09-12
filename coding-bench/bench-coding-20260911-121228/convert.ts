// Temperature conversion functions

/**
 * Convert temperature between Celsius, Fahrenheit, and Kelvin.
 * @param value - The temperature value to convert
 * @param from - The source unit ('C', 'F', or 'K')
 * @param to - The target unit ('C', 'F', or 'K')
 * @returns The converted temperature value
 */
export function convertTemp(value: number, from: string, to: string): number {
  // Validate units
  if (from !== 'C' && from !== 'F' && from !== 'K') {
    throw new Error('Unknown unit');
  }
  if (to !== 'C' && to !== 'F' && to !== 'K') {
    throw new Error('Unknown unit');
  }

  // Convert to Celsius first, then to target unit
  let tempC: number;
  if (from === 'C') {
    tempC = value;
  } else if (from === 'F') {
    tempC = (value - 32) * 5 / 9;
  } else if (from === 'K') {
    tempC = value - 273.15;
  }

  // Convert from Celsius to target
  if (to === 'C') {
    return tempC;
  } else if (to === 'F') {
    return (tempC * 9 / 5) + 32;
  } else if (to === 'K') {
    return tempC + 273.15;
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
