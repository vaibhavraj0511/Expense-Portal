// js/validation.js — Shared form validation helpers
// Requirements: 1.4, 1.5, 1.6, 6.3, 6.4, 6.5, 11.5, 11.6, 13.3, 13.4, 14.3, 14.4, 14.5,
//               15.3, 15.4, 15.5, 16.3, 16.4, 16.7

/**
 * Checks that each field in `fields` is present and non-whitespace in `formData`.
 * @param {Object} formData
 * @param {string[]} fields
 * @returns {{ valid: boolean, errors: string[] }}
 */
function requireFields(formData, fields) {
  const errors = [];
  for (const field of fields) {
    const value = formData[field];
    if (value === undefined || value === null || String(value).trim() === '') {
      errors.push(`${field} is required`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Checks that `value` is numeric and strictly greater than 0.
 * @param {*} value
 * @returns {{ valid: boolean, errors: string[] }}
 */
function requirePositiveNumber(value) {
  const num = Number(value);
  if (isNaN(num) || num <= 0) {
    return { valid: false, errors: ['Amount must be a positive number'] };
  }
  return { valid: true, errors: [] };
}

/**
 * Checks that `dateStr` (YYYY-MM-DD) is strictly after today.
 * @param {string} dateStr
 * @returns {{ valid: boolean, errors: string[] }}
 */
function requireFutureDate(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(dateStr);
  if (isNaN(date.getTime()) || date <= today) {
    return { valid: false, errors: ['Date must be in the future'] };
  }
  return { valid: true, errors: [] };
}

/**
 * Checks that `a` and `b` are different values.
 * @param {*} a
 * @param {*} b
 * @param {string} label  Used in the error message
 * @returns {{ valid: boolean, errors: string[] }}
 */
function requireDifferentValues(a, b, label) {
  if (a === b) {
    return { valid: false, errors: [`${label} must be different`] };
  }
  return { valid: true, errors: [] };
}

export { requireFields, requirePositiveNumber, requireFutureDate, requireDifferentValues };
