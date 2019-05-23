/* eslint @typescript-eslint/interface-name-prefix: 0 */

declare module 'ipfs-log' {
  import IPFS from 'ipfs';
  import IdentityProvider, { Identity } from 'orbit-db-identity-provider';

  type EntryDataPrimitive = string | number | Buffer | Date;

  interface IPFSLog {
    readonly length: number;
  }

  namespace IPFSLog {
    // It has to be stringifyable. Maybe we can do better
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    export type EntryData = any;

    export class LamportClock {
      public static compare(clockA: LamportClock, clockB: LamportClock): number;
      constructor(id: string, time: number);
      public tick(): LamportClock;
      public merge(clock: LamportClock): LamportClock;
      public clone(): LamportClock;
    }

    export class Entry {
      public static create(
        ipfs: IPFS,
        identity: Identity,
        logId: string,
        data: EntryData,
        next: (string | Entry)[],
        clock: LamportClock,
      ): Promise<Entry>;
      public static verify(
        identityProvider: IdentityProvider,
        entry: Entry,
      ): Promise<boolean>;
      public static toBuffer(entry: Entry): Buffer;
      public static toMultihash(ipfs: IPFS, entry: Entry): Promise<string>;
      public static fromMultihash(ipfs: IPFS, hash: string): Promise<Entry>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      public static isEntry(obj: Record<string, any>): boolean;
      public static compare(entryA: Entry, entryB: Entry): boolean;
      public static isParent(entryA: Entry, entryB: Entry): boolean;
      public static findChildren(entry: Entry, value: Entry[]): Entry[];
      public hash: string | null;
      public id: string;
      public payload: EntryData;
      public nexts: (string | Entry)[];
      public v: number;
      public clock: LamportClock;
    }
  }

  export = IPFSLog;
}
