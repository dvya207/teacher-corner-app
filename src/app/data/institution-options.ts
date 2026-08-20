import { InstitutionDraft } from '../models/teaching.model';
import { DEFAULT_COUNTRY, DEFAULT_DIAL } from './countries';

/**
 * Controlled vocabularies for the institution forms.
 *
 * Static rather than a Firestore lookup: these change with a code release, not
 * with user data. Reading them from the database would mean another collection,
 * another rule block, and a round trip before the form could render.
 *
 * Each list stores a CODE and shows a LABEL, because production does. The table
 * has room for "CBSE" and the Board tab shows the full name; medium is stored
 * as "EN" and shown as "English". One value in Firestore, two surfaces.
 */

/**
 * Countries and dial codes both come from countries.ts, so the Country select and
 * the phone control can never disagree about which countries exist. Re-exported
 * here because this is the module the forms already import their vocabularies from.
 */
export { COUNTRY_NAMES as COUNTRIES, DEFAULT_COUNTRY, DIAL_CODES, dialFor } from './countries';

export const BOARDS = [
  { code: 'CBSE',  label: 'Central Board Of Secondary Education' },
  { code: 'ICSE',  label: 'Indian Certificate Of Secondary Education' },
  { code: 'IB',    label: 'International Baccalaureate' },
  { code: 'IGCSE', label: 'International General Certificate Of Secondary Education' },
  { code: 'State', label: 'State Board' },
  { code: 'UPMSP', label: 'UP Madhyamik Shiksha Parishad' },
  { code: 'Other', label: 'Other' }
] as const;

/** medium is stored as a two-letter code — production has "EN". */
export const MEDIUMS = [
  { code: 'EN', label: 'English' },
  { code: 'HI', label: 'Hindi' },
  { code: 'KN', label: 'Kannada' },
  { code: 'MR', label: 'Marathi' },
  { code: 'TA', label: 'Tamil' },
  { code: 'TE', label: 'Telugu' },
  { code: 'OT', label: 'Other' }
] as const;

/**
 * typeofSchool stores the FULL label — production has "Private School", not a
 * code. The table abbreviates it for display; nothing abbreviates it on write.
 */
export const SCHOOL_TYPES = [
  { value: 'Private School',    short: 'Pvt' },
  { value: 'Government School', short: 'Govt' }
] as const;

export const GENDER_TYPES = ['Boys', 'Girls', 'Co-ed'] as const;

export const WIZARD_STEPS = [
  { index: 1, label: 'Institution Info' },
  { index: 2, label: 'Programme Template' },
  { index: 3, label: 'Review' }
] as const;

/** Full board name for a stored code, falling back to the code itself. */
export function boardLabel(code: string): string {
  return BOARDS.find(board => board.code === code)?.label ?? code;
}

/** Language name for a stored medium code. */
export function mediumLabel(code: string): string {
  return MEDIUMS.find(medium => medium.code === code)?.label ?? code;
}

/**
 * "Pvt" / "Govt" for the table's TYPE badge.
 *
 * Derived rather than stored: a second field holding the abbreviation would be
 * one more thing that can disagree with typeofSchool.
 */
export function schoolTypeShort(typeofSchool: string): string {
  return SCHOOL_TYPES.find(type => type.value === typeofSchool)?.short ?? '—';
}

/**
 * Subscriber digits only — no dial code, no separators.
 *
 * The dial code is a separate field, so mixing it into this one would store the
 * country twice and break any comparison against production data.
 */
export function toSubscriberDigits(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '');

  // Someone typed the country code anyway, despite the visible prefix.
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }

  // Domestic trunk prefix.
  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.slice(1);
  }

  return digits;
}

/** Dial code + number, for display only. Never written to Firestore joined. */
export function displayPhone(countryCode: string, number: string): string {
  if (!number) {
    return '';
  }

  return `${countryCode || '+91'}${number}`;
}

/**
 * A blank draft.
 *
 * Country and its dial code are the only fields that start populated, defaulting
 * to India exactly as production's form opens. Everything else is empty and must
 * be filled before the wizard will advance.
 */
export function emptyDraft(): InstitutionDraft {
  return {
    institutionName: '',
    board: '',
    genderType: '',
    institutionAddress: {
      city: '',
      country: DEFAULT_COUNTRY,
      district: '',
      landmark: '',
      pincode: '',
      state: '',
      street: '',
      subDistrict: '',
      village: ''
    },
    // Not on the Add form; filled later on the edit modal's Basic Info tab.
    institutionCode: '',
    medium: '',
    registrationNumber: '',
    representativeCountryCode: DEFAULT_DIAL,
    representativePhoneNumber: '',
    representativeEmail: '',
    representativeFirstName: '',
    representativeLastName: '',
    typeofSchool: '',
    // Not on the Add form; an institution becomes a customer later, on the edit
    // modal's Basic Info tab.
    customerSchool: false,
    active: true,
    verified: false
  };
}
