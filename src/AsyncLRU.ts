/**
 * @file AsyncLRU. A LRU implementation tailored to our needs. This might be
 * extended with even mor specific logic.
 */

import Yallist = require('yallist');
import debug = require('debug');

type LoadFn<K, V> = (key: K) => Promise<V>;
type RemoveFn<K, V> = (key: K, value: V | void) => Promise<void>;

interface Config<K, V> {
  max: number;
  load: LoadFn<K, V>;
  remove?: RemoveFn<K, V>;
}

interface Entry<K, V> {
  key: K;
  loading: Promise<V | void>;
  removing?: Promise<V | void>;
  afterRemoval?: () => Promise<V | void>;
}

const log = debug('pinner:lru');

const createEntry = <K, V>(
  key: K,
  loading: Promise<V | void>,
  removing?: Promise<V | void>,
): Entry<K, V> => ({
  key,
  loading,
  removing,
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

  // Actually add a key to the list that did not exist before
  private async add(key: K): Promise<V> {
    const loading = this.loadFn(key);
    // Add a new entry to the top of our doubly-linked-list
    this.llist.unshift(createEntry(key, loading));
    // We know the head exists (because we just added it) but eslint wants to be
    // sure. This links the newly created entry to the key in our map.
    if (this.llist.head) this.map.set(key, this.llist.head);
    if (this.length > this.max) {
      /**
       * There is a trade-off to be done here. We could await the deletion
       * before adding another store to have a predictable cache length. But
       * this could result in a queue of stores being added (resulting in
       * possible duplicates), so we sacrifice a predictable length for predictable
       * content
       */
      if (this.llist.tail) this.del(this.llist.tail).catch(log);
    }
    return loading;
  }

  // Creates the promise that eventually calls the removeFn and unlinks the node
  private async createRemovalPromise(
    node: Yallist.Node<Entry<K, V>>,
  ): Promise<V | void> {
    const loaded = await this.removeEntry(node.value);
    const { afterRemoval } = node.value;
    this.unlink(node);
    if (afterRemoval) {
      return afterRemoval();
    }
    return loaded;
  }

  // Sets a node to be flagged for removal
  private async del(node: Yallist.Node<Entry<K, V>>): Promise<V | void> {
    // If we wanted to open it again after removal, cancel that
    node.value.afterRemoval = undefined;

    // If we're already removing, just return that
    if (node.value.removing) return node.value.removing;

    // Otherwise create the removal promise
    node.value.removing = this.createRemovalPromise(node);
    return node.value.removing;
  }

  // Removes the item from the cache (called after the async removal)
  private unlink(node: Yallist.Node<Entry<K, V>>): void {
    this.map.delete(node.value.key);
    this.llist.removeNode(node);
  }

  // Handles the call of the removal function (can just be called after loaded)
  private async removeEntry(entry: Entry<K, V>): Promise<V | void> {
    try {
      const loaded = await entry.loading;
      if (typeof this.removeFn == 'function') {
        await this.removeFn(entry.key, loaded);
      }
      return loaded;
    } catch (caughtError) {
      /** Assumption here is that the entry was removed already or could not be
       * removed. We remove it from the cache anyways
       * We could also throw here and bubble up to remove to let the outer
       * application decide what to do.
       */
      log(caughtError);
    }
  }

  // Get the length of the cache (entry count)
  public get length(): number {
    return this.llist.length;
  }

  // Check whether our cache has a certain key (does not check for removal flag)
  public has(key: K): boolean {
    return this.map.has(key);
  }

  // Loads an entry. Also handles cases where it exsists already and when it
  // might be in the process of being removed
  public async load(key: K): Promise<V | void> {
    const node = this.map.get(key);
    if (node) {
      if (node.value.removing) {
        // If we're already removing the node, tell it to add itself again
        // afterwards
        node.value.afterRemoval = (): Promise<V | void> => this.add(key);
        return node.value.removing;
      }
      // Node is already there and loading (or done), so we move it to the top
      this.llist.unshiftNode(node);
      // Just return the node
      return node.value.loading;
    }
    // No node available, we add a new one
    return this.add(key);
  }

  // Asynchronouly remove an entry from the cache
  public async remove(key: K): Promise<V | void> {
    const node = this.map.get(key);
    if (!node) return;
    return this.del(node);
  }

  // Asynchronously wipes the cache (calls all the removal functions)
  public async reset(): Promise<(V | void)[]> {
    const removePromises = this.llist
      .toArray()
      .map((entry): Promise<V | void> => this.removeEntry(entry));
    this.llist = new Yallist();
    this.map = new Map();
    return Promise.all(removePromises);
  }
}

export default AsyncLRU;
