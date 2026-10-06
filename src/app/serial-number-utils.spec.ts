import { describe, expect, it } from 'vitest';
import { findSerialSuggestions, isValidChargerSerial, normalizeSerialNumber } from './serial-number-utils';

const knownSerial = 'TACW2244723S0930';

describe('serial-number-utils', () => {
  it('normalizes trailing, internal, and pasted separator whitespace consistently', () => {
    expect(normalizeSerialNumber('  tacw 2244723s-0930  ')).toBe(knownSerial);
    expect(isValidChargerSerial(' tacw2244723s0930 ')).toBe(true);
  });

  it('accepts only the observed TACW serial lengths and characters', () => {
    expect(isValidChargerSerial('TACW1234567890')).toBe(true);
    expect(isValidChargerSerial('TACW12345678901')).toBe(true);
    expect(isValidChargerSerial('TACW123456789012')).toBe(true);
    expect(isValidChargerSerial('ABCD123456789012')).toBe(false);
    expect(isValidChargerSerial('TACW123456789')).toBe(false);
    expect(isValidChargerSerial('TACW1234567890123')).toBe(false);
  });

  it('ranks exact and partial matches before fuzzy suggestions', () => {
    const candidates = [
      { serial: 'TACW2244723S0931', model: 'Model B' },
      { serial: knownSerial, model: 'Model A' },
      { serial: 'TACW2244723S1930', model: 'Model C' }
    ];

    expect(findSerialSuggestions(` ${knownSerial.toLowerCase()} `, candidates).matches[0].serial)
      .toBe(knownSerial);
    expect(findSerialSuggestions('TACW224', candidates).matches.map(({ serial }) => serial))
      .toEqual(candidates.map(({ serial }) => serial));
    expect(findSerialSuggestions('2244723S0930', candidates).matches[0].serial).toBe(knownSerial);
  });

  it('suggests only one unambiguous single-edit or transposition correction', () => {
    const candidate = { serial: knownSerial };
    expect(findSerialSuggestions('TACW2244723S0903', [candidate]).typo?.serial).toBe(knownSerial);
    expect(findSerialSuggestions('TACW2244723S093X', [
      candidate,
      { serial: 'TACW2244723S0931' }
    ]).typo).toBeNull();
    expect(findSerialSuggestions('TACW2244723S0XXX', [candidate]).typo).toBeNull();
  });

  it('ignores malformed candidates and avoids noisy suggestions for short input', () => {
    expect(findSerialSuggestions('TA', [{ serial: knownSerial }])).toEqual({ matches: [], typo: null });
    expect(findSerialSuggestions('TACW224', [{ serial: 'SAMPLE12345678' }]).matches).toEqual([]);
  });
});