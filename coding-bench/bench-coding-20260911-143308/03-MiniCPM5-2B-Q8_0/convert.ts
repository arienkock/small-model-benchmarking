export function convertTemp(value: number, from: string, to: string): number {
  const units = ["C", "F", "K"];
  if (!units.includes(from)) throw new Error("Unknown from unit");
  if (!units.includes(to)) throw new Error("Unknown to unit");
  switch (from) {
    case "C":
      if (to === "F") return (value * 9 / 5) + 32;
      if (to === "K") return value + 273.15;
      break;
    case "F":
      if (to === "C") return (value - 32) * 5 / 9;
      if (to === "K") return (value - 32) * 5 / 9 + 273.15;
      break;
    case "K":
      if (to === "C") return value - 273.15;
      if (to === "F") return (value - 273.15) * 9 / 5 + 32;
      break;
  }
  throw new Error("Invalid conversion");
}

export function isSupportedUnit(unit: string): boolean {
  return ["C", "F", "K"].includes(unit);
}
