declare module 'orbit-db-store' {
  import EventEmitter from 'events';

  class OrbitDBStore {
    events: EventEmitter;
  }

  export = OrbitDBStore;
}
