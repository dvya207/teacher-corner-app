import {
  boardLabel,
  displayPhone,
  mediumLabel,
  schoolTypeShort,
  toSubscriberDigits
} from './institution-options';

/**
 * Production stores the dial code and the subscriber number in SEPARATE fields
 * (representativeCountryCode "+91", representativePhoneNumber "9999900001").
 * These guard the boundary between them — folding the country code into the
 * number would store the country twice and break comparison with production
 * data.
 */
describe('toSubscriberDigits', () => {

  it('keeps a bare ten-digit number as-is', () => {
    expect(toSubscriberDigits('9876543210')).toBe('9876543210');
  });

  it('drops a country code the user typed despite the visible prefix', () => {
    expect(toSubscriberDigits('919876543210')).toBe('9876543210');
    expect(toSubscriberDigits('+919876543210')).toBe('9876543210');
  });

  it('drops the domestic trunk 0', () => {
    expect(toSubscriberDigits('09876543210')).toBe('9876543210');
  });

  it('ignores spaces, dashes and brackets', () => {
    expect(toSubscriberDigits(' (98765) 43-210 ')).toBe('9876543210');
  });

  it('never returns a +, so the number can never absorb the dial code', () => {
    expect(toSubscriberDigits('+91 98765 43210')).not.toContain('+');
  });

  it('leaves an empty value empty', () => {
    expect(toSubscriberDigits('')).toBe('');
    expect(toSubscriberDigits('   ')).toBe('');
  });
});

describe('label lookups', () => {

  it('expands a board code to its full name for the Board tab', () => {
    expect(boardLabel('CBSE')).toBe('Central Board Of Secondary Education');
  });

  it('falls back to the code when it is unknown, rather than blanking it', () => {
    expect(boardLabel('MYSTERY')).toBe('MYSTERY');
  });

  it('expands the stored medium code, which production writes as EN', () => {
    expect(mediumLabel('EN')).toBe('English');
  });

  it('abbreviates the stored school type for the table badge', () => {
    expect(schoolTypeShort('Private School')).toBe('Pvt');
    expect(schoolTypeShort('Government School')).toBe('Govt');
  });

  it('shows a dash rather than a misleading badge for an unset type', () => {
    expect(schoolTypeShort('')).toBe('—');
  });
});

describe('displayPhone', () => {

  it('joins the two stored fields for display only', () => {
    expect(displayPhone('+91', '9876543210')).toBe('+919876543210');
  });

  it('renders nothing when there is no number, rather than a bare dial code', () => {
    expect(displayPhone('+91', '')).toBe('');
  });
});
