import { Timestamp } from 'firebase/firestore';

/**
 * Conversions between `<input type="datetime-local">` and Firestore Timestamps.
 *
 * ONE COPY, SHARED, and that is the whole point of the file. Both halves lived on
 * the assignment picker, whose own note said a second copy "is how the two would
 * drift" — and then the workflow template's content block needed the same pair for
 * its assignment due date. Two callers is when the note had to be acted on.
 *
 * LOCAL TIME THROUGHOUT, in both directions. India is UTC+5:30, so a UTC round
 * trip moves a deadline by five and a half hours and across a date boundary for
 * anything set before 05:30 — which is exactly the kind of bug nobody sees until a
 * deadline lands on the wrong day.
 */

/**
 * A `datetime-local` value as a Firestore Timestamp, in LOCAL time.
 *
 * PARSED BY HAND rather than handed to `new Date(value)`, and the reason is a real
 * bug rather than caution: a bare date string like '2026-09-05' is parsed as UTC
 * by spec, so it lands 05:30 out for India and on the previous day for anywhere
 * west of UTC. Splitting the parts and using the Date constructor is unambiguously
 * local.
 *
 * A MISSING TIME MEANS MIDNIGHT. The input always supplies one, but a value
 * arriving from elsewhere might not, and NaN hours would make the whole Timestamp
 * invalid rather than merely wrong.
 */
export function timestampFromLocalInput(value: string): Timestamp {
  const [datePart, timePart = '00:00'] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hours, minutes] = timePart.split(':').map(Number);

  return Timestamp.fromDate(
    new Date(year, month - 1, day, hours || 0, minutes || 0)
  );
}

/**
 * A stored Timestamp as an `<input type="datetime-local">` wants it, or ''.
 *
 * DATE AND TIME, because production's own picker takes both: its dialog carries an
 * hour, a minute and an AM/PM control under the calendar. A date-only field would
 * round every deadline to midnight and lose the difference between 'due Friday'
 * and 'due Friday 4pm'.
 *
 * `toISOString` IS NOT USABLE HERE — it renders the instant in UTC, which is the
 * date-boundary bug described above, in the other direction.
 *
 * THE `toDate` CHECK IS NOT PARANOIA. A document read straight from Firestore has
 * real Timestamps, but a fixture or an older document can hold a plain object with
 * `seconds` and `nanoseconds` and no methods, and calling `toDate` on that throws
 * inside a template — where the error surfaces as a blank page rather than as
 * anything pointing here.
 */
export function localInputFromTimestamp(stamp: Timestamp | null | undefined): string {
  if (!stamp?.toDate) {
    return '';
  }

  const date = stamp.toDate();
  const pad = (value: number) => String(value).padStart(2, '0');

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
