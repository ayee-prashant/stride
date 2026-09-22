'use strict';

const lookup = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I']
];

function toRoman(n) {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 3999) {
    throw new RangeError('Input must be an integer between 1 and 3999');
  }

  let num = n;
  let result = '';
  for (const [val, roman] of lookup) {
    while (num >= val) {
      result += roman;
      num -= val;
    }
  }
  return result;
}

module.exports = { toRoman };
