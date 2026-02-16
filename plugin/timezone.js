/**
 * @typedef {Object} ZonedDateParts
 * @property {number} year - Four-digit calendar year.
 * @property {number} month - Calendar month from 1 to 12.
 * @property {number} day - Calendar day from 1 to 31.
 * @property {number} hour - Hour from 0 to 23.
 * @property {number} minute - Minute from 0 to 59.
 * @property {number} second - Second from 0 to 59.
 */

/**
 * Default timezone used when no valid timezone is configured.
 * It follows the computer/server timezone, with UTC as fallback.
 *
 * @type {string}
 */
const DEFAULT_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** @type {Map<string, Intl.DateTimeFormat>} */
const formatterCache = new Map();

/**
 * Convert an unknown date input into a valid Date object.
 *
 * @param {Date|string|number} value - Date-like input.
 * @returns {Date} Parsed Date instance.
 * @throws {Error} When the input cannot be parsed as a valid date.
 */
function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid datetime value');
  }
  return date;
}

/**
 * Left-pad a numeric value to a fixed width with zeroes.
 *
 * @param {number} value - Number to pad.
 * @param {number} width - Minimum width.
 * @returns {string} Zero-padded string.
 */
function padNumber(value, width) {
  return String(value).padStart(width, '0');
}

/**
 * Validate an IANA timezone identifier.
 *
 * @param {string|undefined|null} timeZone - Candidate timezone identifier.
 * @returns {boolean} True when the timezone is valid.
 */
function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Resolve a timezone using a fallback when the configured value is invalid.
 *
 * @param {string|undefined|null} timeZone - Configured timezone identifier.
 * @param {string} [fallback=DEFAULT_TIME_ZONE] - Fallback timezone.
 * @returns {string} Valid timezone identifier.
 */
function normalizeTimeZone(timeZone, fallback = DEFAULT_TIME_ZONE) {
  if (isValidTimeZone(timeZone)) {
    return timeZone;
  }
  return fallback;
}

/**
 * Get a cached Intl formatter for extracting local date-time parts.
 *
 * @param {string} timeZone - Valid IANA timezone identifier.
 * @returns {Intl.DateTimeFormat} Formatter for this timezone.
 */
function getFormatter(timeZone) {
  if (formatterCache.has(timeZone)) {
    return formatterCache.get(timeZone);
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

/**
 * Extract calendar date-time parts in a specific timezone.
 *
 * @param {Date|string|number} value - Date-like input.
 * @param {string} timeZone - Valid IANA timezone identifier.
 * @returns {ZonedDateParts} Date-time parts in the specified timezone.
 */
function getDateParts(value, timeZone) {
  const date = toDate(value);
  const formatter = getFormatter(timeZone);
  const parts = formatter.formatToParts(date);

  /** @type {Record<string, string>} */
  const byType = {};
  parts.forEach((part) => {
    if (part.type !== 'literal') {
      byType[part.type] = part.value;
    }
  });

  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    hour: Number(byType.hour),
    minute: Number(byType.minute),
    second: Number(byType.second),
  };
}

/**
 * Compute the UTC offset in minutes for a date in a specific timezone.
 *
 * @param {Date|string|number} value - Date-like input.
 * @param {string} timeZone - Valid IANA timezone identifier.
 * @returns {number} Offset minutes where positive means east of UTC.
 */
function getOffsetMinutes(value, timeZone) {
  const date = toDate(value);
  const parts = getDateParts(date, timeZone);
  const zonedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    date.getUTCMilliseconds(),
  );
  return Math.round((zonedAsUtc - date.getTime()) / 60000);
}

/**
 * Format UTC offset minutes as ISO-8601 offset.
 *
 * @param {number} offsetMinutes - Offset minutes relative to UTC.
 * @returns {string} Offset string like `+10:00` or `-05:30`.
 */
function formatOffset(offsetMinutes) {
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  return `${sign}${padNumber(hours, 2)}:${padNumber(minutes, 2)}`;
}

/**
 * Format a date as `YYYY-MM-DD` in the specified timezone.
 *
 * @param {Date|string|number} value - Date-like input.
 * @param {string} timeZone - Valid IANA timezone identifier.
 * @returns {string} Local date string in the given timezone.
 */
function getDateStringForTimeZone(value, timeZone) {
  const parts = getDateParts(value, timeZone);
  return `${padNumber(parts.year, 4)}-${padNumber(parts.month, 2)}-${padNumber(parts.day, 2)}`;
}

/**
 * Format a date as ISO-8601 datetime with timezone offset.
 *
 * @param {Date|string|number} value - Date-like input.
 * @param {string} timeZone - Valid IANA timezone identifier.
 * @returns {string} Date-time string with offset, e.g. `2026-02-13T08:10:00.000+10:00`.
 */
function formatDateTimeForTimeZone(value, timeZone) {
  const date = toDate(value);
  const parts = getDateParts(date, timeZone);
  const offset = formatOffset(getOffsetMinutes(date, timeZone));
  const milliseconds = padNumber(date.getUTCMilliseconds(), 3);

  return `${padNumber(parts.year, 4)}-${padNumber(parts.month, 2)}-${padNumber(parts.day, 2)}`
    + `T${padNumber(parts.hour, 2)}:${padNumber(parts.minute, 2)}:${padNumber(parts.second, 2)}`
    + `.${milliseconds}${offset}`;
}

module.exports = {
  DEFAULT_TIME_ZONE,
  formatDateTimeForTimeZone,
  getDateStringForTimeZone,
  isValidTimeZone,
  normalizeTimeZone,
};
