/**
 * Progressive field unlocking, shared by every create form in this app.
 *
 * THE RULE: a field is locked until every required field BEFORE it has a value.
 * The first field is always open, and the form unlocks one field at a time as it
 * is filled, top to bottom.
 *
 * WHY A HELPER RATHER THAN A CONDITION PER CONTROL. The Add Institution form has
 * nineteen fields; writing "disabled unless the eighteen above me are filled" on
 * the last of them by hand is nineteen chances to get the chain wrong, and it
 * silently rots the moment a field is inserted. Here each form states its field
 * ORDER once, and the locking follows from it.
 *
 * AN OPTIONAL FIELD NEVER BLOCKS. Landmark is optional on the institution form,
 * so leaving it empty must not stop the user reaching City. It can be filled at
 * any time once reached, and is simply skipped when deciding what comes next.
 */
export interface FlowField {
  /** The control's id, which is what `isFieldLocked` is asked about. */
  name: string;
  /** Whether the field currently holds a value. */
  filled: boolean;
  /** Optional fields are skipped when deciding whether later fields unlock. */
  optional?: boolean;
}

/**
 * The name of the first field that is still locked, or null when the whole chain
 * is open.
 *
 * Forms use this to explain the locking exactly once, under the first shut
 * control, rather than repeating a hint under every one of them.
 */
export function firstLockedField(chain: readonly FlowField[]): string | null {
  let blocked = false;

  for (const field of chain) {
    if (blocked) {
      return field.name;
    }

    // A required field that is empty closes everything after it. An optional one
    // is transparent: empty or not, the chain continues through it.
    if (!field.optional && !field.filled) {
      blocked = true;
    }
  }

  return null;
}

/** Whether this field is still locked. Unknown names are never locked. */
export function isFieldLocked(chain: readonly FlowField[], name: string): boolean {
  for (const field of chain) {
    if (field.name === name) {
      return false;
    }

    if (!field.optional && !field.filled) {
      // Everything from here on is locked, including `name` if it is in the
      // chain at all. A name that is not in the chain reaches the end and is
      // reported unlocked, so a control the form forgot to list stays usable
      // rather than becoming permanently dead.
      return chain.some(candidate => candidate.name === name);
    }
  }

  return false;
}

/** How many fields of the chain are open, for a progress readout. */
export function unlockedCount(chain: readonly FlowField[]): number {
  const first = firstLockedField(chain);

  if (first === null) {
    return chain.length;
  }

  return chain.findIndex(field => field.name === first);
}
