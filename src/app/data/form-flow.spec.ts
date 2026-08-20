import { FlowField, firstLockedField, isFieldLocked, unlockedCount } from './form-flow';

/**
 * Progressive field unlocking.
 *
 * The rule every create form now follows: a field is locked until every required
 * field before it has a value. These pin the three cases that are easy to get
 * wrong — the first field, an optional field in the middle, and a name the form
 * forgot to list.
 */

function chain(...spec: [string, boolean, boolean?][]): FlowField[] {
  return spec.map(([name, filled, optional]) => ({ name, filled, optional }));
}

describe('form-flow', () => {

  it('leaves the first field open on an empty form', () => {
    const fields = chain(['a', false], ['b', false], ['c', false]);

    expect(isFieldLocked(fields, 'a')).toBe(false);
    expect(isFieldLocked(fields, 'b')).toBe(true);
    expect(isFieldLocked(fields, 'c')).toBe(true);
    expect(firstLockedField(fields)).toBe('b');
    expect(unlockedCount(fields)).toBe(1);
  });

  /**
   * The field being filled is itself OPEN — it is the next one that is shut. So
   * with only `a` filled, `b` is where the user is typing and `c` is the first
   * locked field; once `b` is filled too, `c` opens and nothing is locked.
   */
  it('opens one more field for each one filled', () => {
    expect(firstLockedField(chain(['a', false], ['b', false], ['c', false]))).toBe('b');
    expect(firstLockedField(chain(['a', true], ['b', false], ['c', false]))).toBe('c');
    expect(firstLockedField(chain(['a', true], ['b', true], ['c', false]))).toBeNull();

    expect(unlockedCount(chain(['a', false], ['b', false], ['c', false]))).toBe(1);
    expect(unlockedCount(chain(['a', true], ['b', false], ['c', false]))).toBe(2);
    expect(unlockedCount(chain(['a', true], ['b', true], ['c', false]))).toBe(3);
  });

  it('reports the whole chain open when nothing is missing', () => {
    const fields = chain(['a', true], ['b', true]);

    expect(isFieldLocked(fields, 'a')).toBe(false);
    expect(isFieldLocked(fields, 'b')).toBe(false);
    expect(unlockedCount(fields)).toBe(2);
  });

  /**
   * An optional field must not be able to hold the form shut. Landmark is
   * optional on the institution form, and an empty one cannot be allowed to
   * block City.
   */
  it('lets an empty optional field through', () => {
    const fields = chain(['a', true], ['optional', false, true], ['c', false]);

    expect(isFieldLocked(fields, 'optional')).toBe(false);
    expect(isFieldLocked(fields, 'c')).toBe(false);
    expect(firstLockedField(fields)).toBeNull();
  });

  it('still locks after a required field that follows an optional one', () => {
    const fields = chain(['a', true], ['optional', false, true], ['c', false], ['d', false]);

    expect(isFieldLocked(fields, 'c')).toBe(false);
    expect(isFieldLocked(fields, 'd')).toBe(true);
  });

  /** Refilling backwards re-locks what comes after, so the chain is honest. */
  it('re-locks later fields when an earlier one is cleared', () => {
    expect(isFieldLocked(chain(['a', true], ['b', true], ['c', true]), 'c')).toBe(false);
    expect(isFieldLocked(chain(['a', false], ['b', true], ['c', true]), 'c')).toBe(true);
  });

  /**
   * A control the form forgot to list must stay usable rather than becoming
   * permanently dead — the failure mode of a helper like this should be an
   * unlocked field, never an unreachable one.
   */
  it('never locks a name that is not in the chain', () => {
    const fields = chain(['a', false], ['b', false]);

    expect(isFieldLocked(fields, 'not-listed')).toBe(false);
  });

  it('handles an empty chain', () => {
    expect(firstLockedField([])).toBeNull();
    expect(isFieldLocked([], 'a')).toBe(false);
    expect(unlockedCount([])).toBe(0);
  });
});
