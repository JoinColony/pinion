/**
 * @file AsyncLRU. A LRU implementation tailored to our needs. This might be
 * extended with even mor specific logic.
 *
 * API:
 * const cache = new AsyncLRU({ max, load, remove })
 * const store = await cache.load(storeAddress)
 * await cache.remove(storeAddress)
 */

import Yallist = require('yallist');
import debug = require('debug');

type LoadFn<K, V> = (key: K) => Promise<V>;
type RemoveFn<K, V> = (key: K, value: V) => Promise<void>;

interface Config<K, V> {
  max: number;
  load: LoadFn<K, V>;
  remove?: RemoveFn<K, V>;
}

interface Entry<K, V> {
  key: K;
  loadPromise: Promise<V>;
  removePromise?: Promise<void>;
}

const log = debug('pinner:lru');

const createEntry = <K, V>(
  key: K,
  loadPromise: Promise<V>,
  removePromise?: Promise<void>,
): Entry<K, V> => ({
  key,
  loadPromise,
  removePromise,
});

class AsyncLRU<K, V> {
  private readonly max: number;

  private readonly loadFn: LoadFn<K, V>;

  private readonly removeFn?: RemoveFn<K, V>;

  private llist: Yallist<Entry<K, V>>;

  private map: Map<K, Yallist.Node<Entry<K, V>>>;

  constructor({ max, load, remove }: Config<K, V>) {
    this.max = max;
    this.loadFn = load;
    this.removeFn = remove;
    this.llist = new Yallist();
    this.map = new Map();
  }

  private async add(key: K): Promise<V> {
    const loadPromise = this.loadFn(key);
    this.llist.unshift(createEntry(key, loadPromise));
    if (this.llist.head) this.map.set(key, this.llist.head);
    if (this.length >= this.max) {
      // There is a trade-off to be done here. We could await the deletion
      // before adding another store to have a predictable cache length. But
      // this could result in a queue of stores being added (resulting in
      // possible duplicates), so we sacrifice a predictable length for predictable
      // content
      if (this.llist.tail) this.del(this.llist.tail).catch(log);
    }
    return loadPromise;
  }

  private unlink(node: Yallist.Node<Entry<K, V>>): void {
    this.map.delete(node.value.key);
    this.llist.removeNode(node);
  }

  private async removeEntry(entry: Entry<K, V>): Promise<void> {
    if (typeof this.removeFn != 'function') return;
    try {
      const value = await entry.loadPromise;
      await this.removeFn(entry.key, value);
    } catch (caughtError) {
      // Assumption here is that the entry was removed already or could not be
      // removed. We remove it from the cache anyways
      // We could also throw here and bubble up to remove to let the outer
      // application decide what to do.
      log(caughtError);
    }
  }

  private async del(node: Yallist.Node<Entry<K, V>>): Promise<void> {
    const removePromise = this.removeEntry(node.value).then(
      (): void => this.unlink(node),
    );
    node.value.removePromise = removePromise;
    return removePromise;
  }

  public get length(): number {
    return this.llist.length;
  }

  public async load(key: K): Promise<V> {
    const node = this.map.get(key);
    if (node) {
      if (node.value.removePromise) {
        // Node is meant to be removed, let's wait for that to happen first
        try {
          await node.value.removePromise;
        } catch (caughtError) {
          log(caughtError);
          // Unlink manually
          this.unlink(node);
        }
        return this.add(key);
      }
      // Node is already there and loading (or done), so we move it to the top
      this.llist.unshiftNode(node);
      // Just return the node
      return node.value.loadPromise;
    }
    // No node available, we add a new one
    return this.add(key);
  }

  public async remove(key: K): Promise<void> {
    const node = this.map.get(key);
    if (!node) return;
    return this.del(node);
  }

  public async reset(): Promise<void[]> {
    const removePromises = this.llist
      .toArray()
      .map((entry): Promise<void> => this.removeEntry(entry));
    this.llist = new Yallist();
    this.map = new Map();
    return Promise.all(removePromises);
  }
}

export default AsyncLRU;
