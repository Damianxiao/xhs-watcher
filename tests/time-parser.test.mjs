import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseXhsRelativeTime } from '../lib/time-parser.mjs';

const NOW = new Date('2026-05-16T14:00:00+08:00');

test('parses "X 分钟前"', () => {
  const result = parseXhsRelativeTime('30 分钟前', NOW);
  assert.equal(result.toISOString(), new Date('2026-05-16T13:30:00+08:00').toISOString());
});

test('parses "X小时前" (no space)', () => {
  const result = parseXhsRelativeTime('4小时前', NOW);
  assert.equal(result.toISOString(), new Date('2026-05-16T10:00:00+08:00').toISOString());
});

test('parses "X天前"', () => {
  const result = parseXhsRelativeTime('5天前', NOW);
  assert.equal(result.toISOString(), new Date('2026-05-11T14:00:00+08:00').toISOString());
});

test('parses "X周前"', () => {
  const result = parseXhsRelativeTime('2周前', NOW);
  assert.equal(result.toISOString(), new Date('2026-05-02T14:00:00+08:00').toISOString());
});

test('parses "MM-DD" using CST year of now', () => {
  const result = parseXhsRelativeTime('04-11', NOW);
  assert.equal(result.toISOString(), new Date('2026-04-11T00:00:00+08:00').toISOString());
});

test('parses "今天 HH:MM"', () => {
  const result = parseXhsRelativeTime('今天 09:15', NOW);
  assert.equal(result.toISOString(), new Date('2026-05-16T09:15:00+08:00').toISOString());
});

test('parses "昨天 HH:MM"', () => {
  const result = parseXhsRelativeTime('昨天 22:00', NOW);
  assert.equal(result.toISOString(), new Date('2026-05-15T22:00:00+08:00').toISOString());
});

test('parses "YYYY-MM-DD" (absolute)', () => {
  const result = parseXhsRelativeTime('2026-05-10', NOW);
  assert.equal(result.toISOString(), new Date('2026-05-10T00:00:00+08:00').toISOString());
});

test('parses "刚刚"', () => {
  const result = parseXhsRelativeTime('刚刚', NOW);
  assert.equal(result.toISOString(), NOW.toISOString());
});

test('throws on unrecognized format', () => {
  assert.throws(
    () => parseXhsRelativeTime('blah blah', NOW),
    /unrecognized/i,
  );
});
