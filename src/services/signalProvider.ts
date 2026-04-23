export function generateCarbonValue(): number {
  const min = 100;
  const max = 600;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
