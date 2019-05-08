import test from 'ava';
import { stub } from 'sinon';

import AsyncLRU from '../AsyncLRU';

test('Can load an async resource', async t => {
  const value = { foo: 'bar' };
  const cache = new AsyncLRU({
    max: 2,
    load: () => Promise.resolve(value),
  });
  t.is(cache.length, 0);
  const cacheVal = await cache.load('xxx');
  t.is(cache.length, 1);
  t.is(cacheVal, value);
});

test('Loading is idempotent', async t => {
  const value = { foo: 'bar' };
  const loadSpy = stub().resolves(value);
  const cache = new AsyncLRU({
    max: 2,
    load: loadSpy,
  });
  // Hitting it with multiple load requests
  const values = await Promise.all([cache.load('xxx'), cache.load('xxx')]);
  t.is(values[0], value);
  t.is(values[1], value);
  t.true(loadSpy.calledOnce);
});

test('Removing is idempotent', async t => {
  const value = { foo: 'bar' };
  const loadSpy = stub().resolves(value);
  const removeSpy = stub().resolves();
  const cache = new AsyncLRU({
    max: 2,
    load: loadSpy,
    remove: removeSpy,
  });
  await cache.load('xxx');
  // Hitting it with multiple remove requests
  await Promise.all([cache.remove('xxx'), cache.remove('xxx')]);
  t.true(removeSpy.calledOnce);
});

test('Entries will be disposed of when cache is full', async t => {
  const values = [{ foo: 'bar' }, { baz: 'boo' }];
  const load = stub().callsFake((key: number) => Promise.resolve(values[key]));
  const cache = new AsyncLRU({
    max: 1,
    load,
  });
  t.is(cache.length, 0);
  const val0 = await cache.load(0);
  t.is(values[0], val0);
  t.is(cache.length, 1);
  await cache.load(1);
  t.is(cache.length, 1);
  await cache.load(1);
  // val1 was in the cache
  t.true(load.calledTwice);
});

test('Cache will be reordered when a value is accessed', async t => {
  const values = [{ foo: 'bar' }, { baz: 'boo' }, { fiz: 'fee' }];
  const load = stub().callsFake((key: number) => Promise.resolve(values[key]));
  const cache = new AsyncLRU({
    max: 2,
    load,
  });
  await cache.load(0);
  await cache.load(1);
  // Put value 0 on top of the list
  await cache.load(0);
  await cache.load(2);
  // Make sure the least used entry was removed
  t.is(cache.length, 2);
  // Make sure that value 0 was fetched from cache (on top of the list)
  await cache.load(0);
  t.true(load.calledThrice);
  // Make sure that value 1 was not in the list anymore
  await cache.load(1);
  t.is(load.callCount, 4);
});

test('Remove function will be called on manual removal', async t => {
  const value = { foo: 'bar' };
  const loadSpy = stub().resolves(value);
  const removeSpy = stub().resolves();
  const cache = new AsyncLRU({
    max: 2,
    load: loadSpy,
    remove: removeSpy,
  });
  await cache.load('xxx');
  await cache.remove('xxx');
  t.true(removeSpy.calledWith('xxx', value));
});

test('Wait for remove function to be done before adding an item again', async t => {
  const value = { foo: 'bar' };
  const loadSpy = stub().resolves(value);
  let resolveRemoval = () => {};
  const removeSpy = stub().returns(
    new Promise(resolve => {
      resolveRemoval = resolve;
    }),
  );
  const cache = new AsyncLRU({
    max: 5,
    load: loadSpy,
    remove: removeSpy,
  });
  cache.load('xxx');
  t.is(loadSpy.callCount, 1);
  const removePromise = cache.remove('xxx');
  cache.load('xxx');
  // cache.load is waiting for the removal before loading again
  t.is(loadSpy.callCount, 1);
  resolveRemoval();
  await removePromise;
  t.is(loadSpy.callCount, 2);
});

test('Wait for removal until it is loaded', async t => {
  const value = { foo: 'bar' };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let resolveLoad = (value: { foo: string }) => {};
  const loadSpy = stub().returns(
    new Promise(resolve => {
      resolveLoad = resolve;
    }),
  );
  const cache = new AsyncLRU({
    max: 5,
    load: loadSpy,
  });
  cache.load('xxx');
  t.is(cache.length, 1);
  const removePromise = cache.remove('xxx');
  t.is(cache.length, 1);
  // We wait a looong time (in computer time) to prove that it's still there
  await new Promise(resolve => setTimeout(resolve, 200));
  t.is(cache.length, 1);
  resolveLoad(value);
  await removePromise;
  t.is(cache.length, 0);
});

test('It does the right thing', async t => {
  const value = { foo: 'bar' };
  const loadSpy = stub().resolves(value);
  const removeSpy = stub().resolves();
  const cache = new AsyncLRU({
    max: 2,
    load: loadSpy,
    remove: removeSpy,
  });

  cache.load('xxx');
  cache.load('xxy');
  await cache.load('xxz');
  await new Promise(resolve => setTimeout(resolve, 200));
  t.false(cache.has('xxx'));
  t.is(cache.length, 2);

  // Let's do a bunch of things "at the same time"
  cache.remove('xxy');
  cache.load('xxy');
  cache.remove('xxy');
  await new Promise(resolve => setTimeout(resolve, 200));
  t.false(cache.has('xxy'));

  // Let's do a bunch of other things "at the same time"
  cache.load('xxx');
  cache.load('xxx');
  cache.remove('xxx');
  const loadPromise = cache.load('xxx');
  await new Promise(resolve => setTimeout(resolve, 200));
  t.true(cache.has('xxx'));
  const result = await loadPromise;
  t.is(result, value);
});
