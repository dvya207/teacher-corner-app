import { toPhoneDigits } from './teacher-options';

/**
 * The Add Teachers step's phone normalisation.
 *
 * WHY THIS MATTERS BEYOND THE FORM. Whatever this stores becomes
 * `teacherMeta.phoneNumber`, and that field is the ONLY key linking a registered
 * teacher to the Firebase account they later sign in with. A number mangled here
 * is a teacher who can never be linked, with nothing in the UI to say why.
 *
 * It used to take the FIRST ten digits, so a number pasted with its dial code
 * stored the dial code and lost the end of the real number. It delegates to
 * `toSubscriberDigits` now — the same helper every institution form uses — so all
 * three ends of the linking agree on what a number is.
 */
describe('toPhoneDigits', () => {

  it('keeps a plain ten-digit number', () => {
    expect(toPhoneDigits('9481635184')).toBe('9481635184');
  });

  it('drops a pasted dial code instead of the end of the number', () => {
    // The regression: this returned '9194816351'.
    expect(toPhoneDigits('+919481635184')).toBe('9481635184');
  });

  it('drops the dial code through separators', () => {
    expect(toPhoneDigits('+91 94816-35184')).toBe('9481635184');
  });

  it('drops a domestic trunk prefix', () => {
    expect(toPhoneDigits('09481635184')).toBe('9481635184');
  });

  it('keeps a ten-digit number that legitimately begins 91', () => {
    // 91xxxxxxxx is a real series — Indian mobiles start 6-9 — so the leading 91
    // of a TEN-digit number is part of the number, not a dial code.
    expect(toPhoneDigits('9180000000')).toBe('9180000000');
    expect(toPhoneDigits('9199887766')).toBe('9199887766');
  });

  it('caps overflow from the end, so typing one digit too many costs the last', () => {
    expect(toPhoneDigits('94816351849')).toBe('9481635184');
  });

  it('strips letters and punctuation', () => {
    expect(toPhoneDigits('(948) 163-5184')).toBe('9481635184');
  });

  it('survives an empty or partial value while typing', () => {
    expect(toPhoneDigits('')).toBe('');
    expect(toPhoneDigits('948')).toBe('948');
  });
});
