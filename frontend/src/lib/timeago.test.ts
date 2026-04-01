import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { timeAgo, formatTimestamp } from './timeago';

describe('timeAgo', () => {
  const fixedNow = new Date('2026-03-31T12:00:00Z').getTime();

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(fixedNow);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const now = () => Date.now() / 1000;

  it('returns "Just now" for timestamps less than 10s ago', () => {
    expect(timeAgo(now() - 5)).toBe('Just now');
    expect(timeAgo(now() - 0)).toBe('Just now');
    expect(timeAgo(now() - 9)).toBe('Just now');
  });

  it('returns seconds ago for 10-59s', () => {
    expect(timeAgo(now() - 10)).toBe('10s ago');
    expect(timeAgo(now() - 30)).toBe('30s ago');
    expect(timeAgo(now() - 59)).toBe('59s ago');
  });

  it('returns minutes ago for 1-59 min', () => {
    expect(timeAgo(now() - 60)).toBe('1m ago');
    expect(timeAgo(now() - 300)).toBe('5m ago');
    expect(timeAgo(now() - 3599)).toBe('59m ago');
  });

  it('returns hours ago for 1-23 hours', () => {
    expect(timeAgo(now() - 3600)).toBe('1h ago');
    expect(timeAgo(now() - 7200)).toBe('2h ago');
    expect(timeAgo(now() - 86399)).toBe('23h ago');
  });

  it('returns formatted date for timestamps older than 24h', () => {
    const twoDaysAgo = now() - 86400 * 2;
    const result = timeAgo(twoDaysAgo);
    // Should contain a month abbreviation and day number
    expect(result).toMatch(/\w+ \d+/);
  });

  it('respects 24h time format', () => {
    const twoDaysAgo = now() - 86400 * 2;
    const result = timeAgo(twoDaysAgo, { timeFormat: '24h' });
    // Should not contain AM/PM
    expect(result).not.toMatch(/[AP]M/i);
  });
});

describe('formatTimestamp', () => {
  it('returns a time string with hours, minutes, seconds', () => {
    const ts = new Date('2026-03-31T14:30:45Z').getTime() / 1000;
    const result = formatTimestamp(ts, { timezone: 'UTC', timeFormat: '24h' });
    expect(result).toContain('14');
    expect(result).toContain('30');
    expect(result).toContain('45');
  });

  it('handles 12h format', () => {
    const ts = new Date('2026-03-31T14:30:45Z').getTime() / 1000;
    const result = formatTimestamp(ts, { timezone: 'UTC', timeFormat: '12h' });
    expect(result).toContain('2');
    expect(result).toContain('30');
  });
});
