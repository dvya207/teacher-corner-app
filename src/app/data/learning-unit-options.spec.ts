import {
  emptyLearningUnitDraft,
  languageLabel,
  learningUnitIdOf,
  learningUnitTitle,
  nextVersionLabel,
  storedVersionOf,
  totalTimeLabel,
  unitMetaLabel,
  versionNumberOf
} from './learning-unit-options';
import { LearningUnit } from '../models/teaching.model';

function unit(fields: Partial<LearningUnit>): LearningUnit {
  return { learningUnitDisplayName: '', learningUnitName: '', ...fields } as LearningUnit;
}

describe('learningUnitTitle', () => {

  it('prefers the display name', () => {
    expect(learningUnitTitle(unit({
      learningUnitDisplayName: 'Sundial',
      learningUnitName: 'DIY Sundial'
    }))).toBe('Sundial');
  });

  it('falls back to the name', () => {
    expect(learningUnitTitle(unit({ learningUnitName: 'DIY Sundial' }))).toBe('DIY Sundial');
  });

  /** A whitespace-only display name must fall through, not render a blank cell. */
  it('ignores a whitespace-only display name', () => {
    expect(learningUnitTitle(unit({
      learningUnitDisplayName: '   ',
      learningUnitName: 'DIY Sundial'
    }))).toBe('DIY Sundial');
  });

  it('is empty when neither is set, rather than undefined', () => {
    expect(learningUnitTitle(unit({}))).toBe('');
  });
});

describe('languageLabel', () => {

  it('expands a stored ISO code', () => {
    expect(languageLabel('TA')).toBe('Tamil');
    expect(languageLabel('EN')).toBe('English');
  });

  it('passes an unknown code through rather than blanking it', () => {
    expect(languageLabel('ZZ')).toBe('ZZ');
  });
});

describe('unitMetaLabel', () => {

  /** "TA · EN · vV22" — the sub-line the programme picker renders. */
  it('joins languages and version with the reference separator', () => {
    expect(unitMetaLabel(['TA', 'EN'], 'vV22')).toBe('TA · EN · vV22');
  });

  it('drops an empty version rather than leaving a trailing separator', () => {
    expect(unitMetaLabel(['EN'], '')).toBe('EN');
  });

  it('is empty when there is nothing to show', () => {
    expect(unitMetaLabel([], '')).toBe('');
  });
});

describe('totalTimeLabel', () => {

  it('shows bare minutes under an hour', () => {
    expect(totalTimeLabel(45)).toBe('45m');
  });

  /** "150" is not obviously two and a half hours, which is the whole point. */
  it('splits into hours and minutes past sixty', () => {
    expect(totalTimeLabel(150)).toBe('2h 30m');
  });

  it('drops the minutes on a whole hour', () => {
    expect(totalTimeLabel(120)).toBe('2h');
    expect(totalTimeLabel(60)).toBe('1h');
  });

  it('is a dash for nothing recorded', () => {
    expect(totalTimeLabel(0)).toBe('—');
    expect(totalTimeLabel(-5)).toBe('—');
  });
});

describe('emptyLearningUnitDraft', () => {

  /**
   * A DRAFT, and no language chosen.
   *
   * Both are production's create-time behaviour and both changed when the Add
   * dialog gained the rest of production's fields. A new unit has no guide, video
   * or template yet, so creating it LIVE would put an empty activity into every
   * programme picker; and the language cannot be defaulted because the version
   * number is computed per language — 'EN' pre-selected would silently number the
   * unit into the English family for someone adding the Tamil one.
   */
  it('starts as a draft with no language chosen', () => {
    const draft = emptyLearningUnitDraft();

    expect(draft.status).toBe('DEVELOPEMENT');
    expect(draft.isoCode).toBe('');
  });

  /** The three the Add dialog does not ask for, at production's defaults. */
  it('carries production\'s create-time defaults for the unasked fields', () => {
    const draft = emptyLearningUnitDraft();

    expect(draft.totalTime).toBe(45);
    expect(draft.difficultyLevel).toBe('0');
    expect(draft.shortDescription).toBe('');
  });

  it('leaves every identity and categorisation field empty', () => {
    const draft = emptyLearningUnitDraft();

    expect(draft.learningUnitCode).toBe('');
    expect(draft.learningUnitName).toBe('');
    expect(draft.type).toBe('');
    expect(draft.typeCode).toBe('');
    expect(draft.Maturity).toBe('');
    expect(draft.subjectCode).toBe('');
    expect(draft.domainName).toBe('');
    expect(draft.subDomainName).toBe('');
    expect(draft.compositeCode).toBe('');
  });
});

/* ==========================================================================
   Versions
   ==========================================================================
   The arithmetic behind the Version Number field. Worth its own tests because
   both halves are off-by-one traps: V10 is version ONE, and the number climbs by
   whole units rather than by tenths. */

function versioned(
  learningUnitCode: string,
  isoCode: string,
  version: string,
  typeCode = 'TA'
): LearningUnit {
  return { learningUnitCode, isoCode, version, typeCode } as LearningUnit;
}

describe('versionNumberOf', () => {

  it('reads the number after the V', () => {
    expect(versionNumberOf('V10')).toBe(10);
    expect(versionNumberOf('V22')).toBe(22);
  });

  it('is zero for anything unparseable, never NaN', () => {
    expect(versionNumberOf('')).toBe(0);
    expect(versionNumberOf('draft')).toBe(0);
    expect(versionNumberOf(undefined as unknown as string)).toBe(0);
  });
});

describe('storedVersionOf', () => {

  it('drops the language prefix the form field carries', () => {
    expect(storedVersionOf('EN-V10')).toBe('V10');
    expect(storedVersionOf('TA-V22')).toBe('V22');
  });

  /** Already stored-shape input passes through, so the call is idempotent. */
  it('leaves a bare version alone', () => {
    expect(storedVersionOf('V10')).toBe('V10');
  });
});

describe('nextVersionLabel', () => {

  it('starts a new family at V10, not V1', () => {
    expect(nextVersionLabel([], 'AE04', 'EN', 'TA')).toBe('EN-V10');
  });

  it('is one past the highest in the family', () => {
    const units = [
      versioned('AE04', 'EN', 'V10'),
      versioned('AE04', 'EN', 'V12'),
      versioned('AE04', 'EN', 'V11')
    ];

    expect(nextVersionLabel(units, 'AE04', 'EN', 'TA')).toBe('EN-V13');
  });

  /**
   * The whole reason the label carries a language: versions run PER LANGUAGE, so
   * a Tamil V14 must not push the English family past V11.
   */
  it('numbers each language independently', () => {
    const units = [
      versioned('AE04', 'EN', 'V10'),
      versioned('AE04', 'TA', 'V14')
    ];

    expect(nextVersionLabel(units, 'AE04', 'EN', 'TA')).toBe('EN-V11');
    expect(nextVersionLabel(units, 'AE04', 'TA', 'TA')).toBe('TA-V15');
  });

  it('ignores other codes and other types', () => {
    const units = [
      versioned('PS07', 'EN', 'V30'),
      versioned('AE04', 'EN', 'V30', 'TT')
    ];

    expect(nextVersionLabel(units, 'AE04', 'EN', 'TA')).toBe('EN-V10');
  });
});

describe('learningUnitIdOf', () => {

  it('joins type code, code and the full version label', () => {
    expect(learningUnitIdOf('TA', 'AE04', 'EN-V10')).toBe('TA-AE04-EN-V10');
  });
});
