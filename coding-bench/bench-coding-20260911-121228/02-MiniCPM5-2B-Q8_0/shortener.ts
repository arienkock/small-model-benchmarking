export function makeCode(length: number): string {
  const chars = string.fromCharCode(65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 97, 98, 99, 100, 101, 102);
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export function isValidCode(code: string): boolean {
  const pattern = /^[A-Za-z0-9]+$/;
  return pattern.test(code) && code.length === makeCode.length;
}
