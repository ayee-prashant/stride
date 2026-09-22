// Two independent pure formatters.
// formatDuration was written by agent1 (gpt-5.6-terra), formatBytes by agent2
// (gpt-5.6-sol), working in parallel on separate branches from one written
// contract. Validated by a third agent against 60 assertions in format.test.mjs.

export function formatDuration(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    throw new TypeError("ms must be a finite number");
  }

  const negative = ms < 0;
  let remainingSeconds = Math.floor(Math.abs(ms) / 1000);
  const days = Math.floor(remainingSeconds / 86_400);
  remainingSeconds %= 86_400;
  const hours = Math.floor(remainingSeconds / 3_600);
  remainingSeconds %= 3_600;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const parts = [];

  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);

  const formatted = parts.length > 0 ? parts.join(" ") : "0s";
  return negative && formatted !== "0s" ? `-${formatted}` : formatted;
}

export function formatBytes(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new TypeError("n must be a finite number");
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.abs(n);
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const displayedValue = unitIndex === 0
    ? Math.round(value)
    : Math.round(value * 10) / 10;
  const normalizedDisplayedValue = displayedValue === 0 ? 0 : displayedValue;
  const prefix = n < 0 && normalizedDisplayedValue !== 0 ? "-" : "";

  return `${prefix}${normalizedDisplayedValue} ${units[unitIndex]}`;
}
