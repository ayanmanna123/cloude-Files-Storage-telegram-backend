/**
 * Converts snake_case string to camelCase
 */
const toCamelCase = (str) => {
  return str.replace(/([-_][a-z])/ig, ($1) => {
    return $1.toUpperCase().replace('-', '').replace('_', '');
  });
};

/**
 * Converts camelCase string to snake_case
 */
const toSnakeCase = (str) => {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
};

/**
 * Deep converts an object's keys from snake_case to camelCase
 */
const keysToCamel = (obj) => {
  if (obj === Object(obj) && !Array.isArray(obj) && typeof obj !== 'function') {
    const n = {};
    Object.keys(obj).forEach(k => {
      n[toCamelCase(k)] = keysToCamel(obj[k]);
    });
    return n;
  } else if (Array.isArray(obj)) {
    return obj.map((i) => keysToCamel(i));
  }
  return obj;
};

/**
 * Deep converts an object's keys from camelCase to snake_case
 */
const keysToSnake = (obj) => {
  if (obj === Object(obj) && !Array.isArray(obj) && typeof obj !== 'function') {
    const n = {};
    Object.keys(obj).forEach(k => {
      n[toSnakeCase(k)] = keysToSnake(obj[k]);
    });
    return n;
  } else if (Array.isArray(obj)) {
    return obj.map((i) => keysToSnake(i));
  }
  return obj;
};

module.exports = {
  keysToCamel,
  keysToSnake,
};
