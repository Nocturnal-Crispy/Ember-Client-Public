/**
 * Unit tests for Steam URL detection and protocol conversion helpers.
 */

import { isSteamUrl, toSteamProtocolUrl } from '../../../src/main/steam-utils';

describe('isSteamUrl', () => {
  it('returns true for Steam store URLs', () => {
    expect(isSteamUrl('https://store.steampowered.com/app/440/')).toBe(true);
  });

  it('returns true for Steam store root URL', () => {
    expect(isSteamUrl('https://store.steampowered.com/')).toBe(true);
  });

  it('returns true for Steam community profile URLs', () => {
    expect(isSteamUrl('https://steamcommunity.com/profiles/76561198012345678')).toBe(true);
  });

  it('returns true for Steam community group URLs', () => {
    expect(isSteamUrl('https://steamcommunity.com/groups/somegroup')).toBe(true);
  });

  it('returns false for non-Steam HTTPS URLs', () => {
    expect(isSteamUrl('https://example.com')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isSteamUrl('')).toBe(false);
  });

  it('returns false for partial domain matches', () => {
    expect(isSteamUrl('https://notstore.steampowered.com/')).toBe(false);
    expect(isSteamUrl('https://notssteamcommunity.com/')).toBe(false);
  });

  it('returns false for http (non-https) Steam URLs', () => {
    expect(isSteamUrl('http://store.steampowered.com/app/440/')).toBe(false);
  });

  it('returns false for steam:// protocol URLs', () => {
    expect(isSteamUrl('steam://openurl/https://store.steampowered.com/')).toBe(false);
  });
});

describe('toSteamProtocolUrl', () => {
  it('converts Steam store URL to steam://openurl format', () => {
    expect(toSteamProtocolUrl('https://store.steampowered.com/app/440/')).toBe(
      'steam://openurl/https://store.steampowered.com/app/440/'
    );
  });

  it('converts Steam community URL to steam://openurl format', () => {
    expect(toSteamProtocolUrl('https://steamcommunity.com/profiles/12345')).toBe(
      'steam://openurl/https://steamcommunity.com/profiles/12345'
    );
  });

  it('preserves the full URL including query strings', () => {
    const url = 'https://store.steampowered.com/app/440/?snr=1_wishlist_4__wishlist-capsule';
    expect(toSteamProtocolUrl(url)).toBe(`steam://openurl/${url}`);
  });
});
