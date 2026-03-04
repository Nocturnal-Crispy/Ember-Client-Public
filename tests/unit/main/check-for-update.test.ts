/**
 * Unit tests for the isNewerVersion helper in src/main.ts
 */

import { isNewerVersion } from '../../../src/version-utils';

describe('isNewerVersion', () => {
  test('returns true when patch is newer', () => {
    expect(isNewerVersion('0.0.13', '0.0.14')).toBe(true);
  });

  test('returns false when versions are equal', () => {
    expect(isNewerVersion('0.0.14', '0.0.14')).toBe(false);
  });

  test('returns false when current is newer (patch)', () => {
    expect(isNewerVersion('0.0.15', '0.0.14')).toBe(false);
  });

  test('returns true when minor is newer', () => {
    expect(isNewerVersion('0.0.99', '0.1.0')).toBe(true);
  });

  test('returns false when current minor is newer', () => {
    expect(isNewerVersion('0.1.0', '0.0.99')).toBe(false);
  });

  test('returns true when major is newer', () => {
    expect(isNewerVersion('0.0.13', '1.0.0')).toBe(true);
  });

  test('returns false when current major is newer', () => {
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(false);
  });

  test('strips leading v from latest', () => {
    expect(isNewerVersion('0.0.13', 'v0.0.14')).toBe(true);
  });

  test('strips leading v from current', () => {
    expect(isNewerVersion('v0.0.13', '0.0.14')).toBe(true);
  });

  test('returns false for malformed current version', () => {
    expect(isNewerVersion('not-a-version', '0.0.14')).toBe(false);
  });

  test('returns false for malformed latest version', () => {
    expect(isNewerVersion('0.0.13', 'beta-1')).toBe(false);
  });

  test('returns false for empty strings', () => {
    expect(isNewerVersion('', '')).toBe(false);
  });
});
