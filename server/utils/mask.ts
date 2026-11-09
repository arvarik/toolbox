export function maskSecret(value: string | null | undefined): string {
  if (!value || typeof value !== "string") return "";
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}

export function isMaskedValue(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("••••");
}
