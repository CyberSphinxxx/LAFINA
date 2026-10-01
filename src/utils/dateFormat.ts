/**
 * Display formatting for timestamps that come straight out of SQLite.
 *
 * A row can carry an empty or malformed timestamp after a partial write or an
 * interrupted sync pull, and `new Date('')` is an Invalid Date. Rendering that
 * literally prints the words "Invalid Date" in the middle of the student's notes
 * and calendar, so every stored value is validated before it is shown.
 */

/**
 * Formats a stored timestamp, falling back to a readable label when it is unusable.
 *
 * @param value Raw timestamp from storage.
 * @param options Intl options forwarded to `toLocaleDateString`.
 * @param fallback Label shown when the value is missing or unparseable.
 * @returns The formatted date, or the fallback label.
 */
export const formatStoredDate = (
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
  fallback = 'No Date',
): string => {
  if (!value) return fallback;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;

  return parsed.toLocaleDateString('en-US', options);
};
