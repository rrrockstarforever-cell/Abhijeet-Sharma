import assert from 'node:assert/strict';
import test from 'node:test';
import { getMcqConcurrencyOverride, imageQuestionConcurrencyLimit, setMcqConcurrencyOverride } from '../src/lib/mcqConcurrency.ts';

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.has(key) ? values.get(key) : null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};

test('manual MCQ concurrency is persisted and clamped to the supported range', () => {
  assert.equal(getMcqConcurrencyOverride(), null);
  assert.equal(setMcqConcurrencyOverride(7), 7);
  assert.equal(getMcqConcurrencyOverride(), 7);
  assert.equal(setMcqConcurrencyOverride(30), 20);
  assert.equal(getMcqConcurrencyOverride(), 20);
});

test('Auto clears the saved MCQ concurrency override', () => {
  values.clear();
  setMcqConcurrencyOverride(4);
  assert.equal(setMcqConcurrencyOverride(null), null);
  assert.equal(getMcqConcurrencyOverride(), null);
});

test('image questions use the existing Auto cap or the manual override', () => {
  values.clear();
  assert.equal(imageQuestionConcurrencyLimit(), 3);
  setMcqConcurrencyOverride(8);
  assert.equal(imageQuestionConcurrencyLimit(), 8);
});

test('legacy values are normalized to the supported range', () => {
  values.clear();
  values.set('pulse.parallelLimit', 'not-a-number');
  assert.equal(getMcqConcurrencyOverride(), null);
  values.set('pulse.parallelLimit', '24.4');
  assert.equal(getMcqConcurrencyOverride(), 20);
});

test('text generation follows the manual override and keeps provider defaults in Auto', async () => {
  values.clear();
  const { parallelRequestLimit } = await import('../src/lib/ai.ts');
  setMcqConcurrencyOverride(6);
  assert.equal(parallelRequestLimit(), 6);
  setMcqConcurrencyOverride(null);
  values.set('ai.activeProvider', 'deeprelay');
  assert.equal(parallelRequestLimit(), 10);
  values.set('ai.activeProvider', 'claude');
  assert.equal(parallelRequestLimit(), 15);
  values.set('ai.activeProvider', 'gemini');
  assert.equal(parallelRequestLimit(), 5);
});

test('non-finite values do not create a manual override', () => {
  values.clear();
  assert.equal(setMcqConcurrencyOverride(Number.NaN), null);
  assert.equal(getMcqConcurrencyOverride(), null);
});

test('a blocked storage write does not report an unapplied manual limit', () => {
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => { throw new Error('storage blocked'); },
    removeItem: () => {},
  };
  try {
    assert.equal(setMcqConcurrencyOverride(9), null);
    assert.equal(getMcqConcurrencyOverride(), null);
  } finally {
    globalThis.localStorage = originalStorage;
  }
});
