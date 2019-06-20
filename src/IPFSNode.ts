/**
 * @file IPFSNode A little abstraction around IPFS to make debugging and error
 * handling easier. It also handles the pubsub subscriptions for us as well as
 * the room peer handling.
 */

import { cid } from 'is-ipfs';

import IPFS = require('ipfs');
import EventEmitter = require('events');
import debug = require('debug');
import PeerMonitor = require('ipfs-pubsub-peer-monitor');

interface Message<T, P> {
  type: T;
  // Can be a store address or an ipfs peer id
  to?: string;
  payload: P;
}

interface Options {
  repo?: string;
  privateKey?: string;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const config = require(`${__dirname}/../ipfsConfig.${process.env.NODE_ENV ||
  'development'}.json`);

const log = debug('pinner:ipfs');
const logError = debug('pinner:ipfs:error');

class IPFSNode {
  private readonly events: EventEmitter;

  private readonly ipfs: IPFS;

  private readonly room: string;

  private readyPromise!: Promise<void>;

  private roomMonitor!: PeerMonitor;

  public id: string = '';

  constructor(
    events: EventEmitter,
    room: string,
    { repo, privateKey }: Options,
  ) {
    this.events = events;
    this.ipfs = new IPFS({
      repo,
      init: { privateKey },
      config,
      EXPERIMENTAL: { pubsub: true },
    });
    this.readyPromise = new Promise(
      (resolve): void => {
        this.ipfs.on('ready', resolve);
      },
    );
    this.room = room;
  }

  private handlePubsubMessage = (msg: IPFS.PubsubMessage): void => {
    if (!(msg && msg.from && msg.data)) {
      logError(`Message is invalid: ${msg}`);
      return;
    }

    // Don't handle messages from ourselves
    if (msg.from === this.id) return;
    log(`New Message from: ${msg.from}`);
    log(msg.data.toString());
    this.events.emit('pubsub:message', msg);
  };

  private handleNewPeer = (peer: string): void => {
    log(`New peer: ${peer}`);
    this.events.emit('pubsub:newpeer', peer);
  };

  private handleLeavePeer = (peer: string): void => {
    log(`Peer left: ${peer}`);
    this.events.emit('pubsub:peerleft', peer);
  };

  public getIPFS(): IPFS {
    return this.ipfs;
  }

  public async getId(): Promise<string> {
    const { id } = await this.ipfs.id();
    return id;
  }

  public async ready(): Promise<void> {
    if (this.ipfs.isOnline()) return;
    return this.readyPromise;
  }

  public async start(): Promise<void> {
    await this.ready();
    this.id = await this.getId();
    await this.ipfs.pubsub.subscribe(this.room, this.handlePubsubMessage);
    log(`Joined room: ${this.room}`);

    this.roomMonitor = new PeerMonitor(this.ipfs.pubsub, this.room);
    this.roomMonitor
      .on('join', this.handleNewPeer)
      .on('leave', this.handleLeavePeer)
      .on('error', logError);
  }

  public async stop(): Promise<void> {
    this.roomMonitor.stop();
    await this.ipfs.pubsub.unsubscribe(this.room, this.handlePubsubMessage);
    return this.ipfs.stop();
  }

  public publish<T, P>(message: Message<T, P>): Promise<void> {
    const msgString = JSON.stringify(message);
    log(`Publishing to room ${this.room}: ${msgString}`);
    return this.ipfs.pubsub.publish(this.room, Buffer.from(msgString));
  }

  public async pinHash(ipfsHash: string): Promise<void> {
    if (!cid(ipfsHash)) {
      logError(`IPFS hash is invalid: ${ipfsHash}`);
      return;
    }
    log(`Pinning ipfs hash: ${ipfsHash}`);
    try {
      await this.ipfs.pin.add(ipfsHash);
    } catch (caughtError) {
      logError(`Could not pin hash ${ipfsHash}: ${caughtError}`);
    }
    this.events.emit('ipfs:pinned', ipfsHash);
  }
}

export default IPFSNode;
