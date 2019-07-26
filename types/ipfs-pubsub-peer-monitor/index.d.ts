declare module 'ipfs-pubsub-peer-monitor' {
  import EventEmitter from 'events';
  import IPFS from 'ipfs';

  interface Options {
    start?: boolean;
    pollInterval?: number;
  }

  class IpfsPubsubPeerMonitor extends EventEmitter {
    constructor(pubsub: IPFS.Pubsub, topic: string, options?: Options);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _peers: any[];

    public start(): void;
    public stop(): void;
    public getPeers(): Promise<string[]>;
    public hasPeer(): boolean;

    public on(event: 'join', listener: (peer: string) => void): this;
    public on(event: 'leave', listener: (peer: string) => void): this;
    public on(event: 'error', listener: (error: Error) => void): this;
  }

  export = IpfsPubsubPeerMonitor;
}
