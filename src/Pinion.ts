/**
 * @file Pinion The main class. It is responsible for the vast amount of communication
 * with the client and starting up the other instances. It also creates and
 * distributes the shared event bus.
 */

import assert = require('assert');
import debug = require('debug');
import EventEmitter = require('events');
import { Entry } from 'ipfs-log';

import IPFS from 'ipfs';

import { ClientActions, PinnerActions } from './actions';

import StoreManager from './StoreManager';
import IPFSNode from './IPFSNode';

const log = debug('pinion:pinion');
const { REPLICATE, PIN_HASH, ANNOUNCE_CLIENT } = ClientActions;
const { HAVE_HEADS, ANNOUNCE_PINNER } = PinnerActions;

interface ClientActionPayload {
  ipfsHash?: string;
  address?: string;
}

export interface ClientAction {
  type: ClientActions;
  payload: ClientActionPayload;
}

interface ReplicationEvent {
  address: string;
  heads: Entry[];
  peer: string;
}

interface ReplicationMessagePayload {
  address: string;
  count: number;
  timestamp: number;
}

interface Options {
  ipfsPrivateKey?: string;
  ipfsRepo?: string;
  maxOpenStores?: number;
  orbitDBDir?: string;
}

class Pinion {
  private readonly ipfsNode: IPFSNode;

  private readonly storeManager: StoreManager;

  // We would like to use it in the tests, so it's public
  public readonly events: EventEmitter;

  constructor(
    room: string,
    {
      maxOpenStores = 100,
      ipfsPrivateKey,
      ipfsRepo = './ipfs',
      orbitDBDir = './orbitdb',
    }: Options = {},
  ) {
    assert(room && room.length, 'Pinning room is required for pinion to start');

    this.events = new EventEmitter();

    this.ipfsNode = new IPFSNode(this.events, room, {
      repo: ipfsRepo,
      privateKey: ipfsPrivateKey,
    });

    this.storeManager = new StoreManager(this.events, this.ipfsNode, {
      maxOpenStores,
      orbitDBDir,
    });

    this.events.on('pubsub:message', this.handleMessage);
    this.events.on('pubsub:newpeer', this.handleNewPeer);
  }

  public get openStores(): number {
    return this.storeManager.openStores;
  }

  private handleMessage = async (
    message: IPFS.PubsubMessage,
  ): Promise<void> => {
    let action: ClientAction | undefined;
    try {
      action = JSON.parse(message.data.toString());
    } catch (e) {
      log('Could not parse pinner message: %O', message.data);
    }

    if (!action) return;
    const { type, payload } = action;
    const { ipfsHash, address } = payload;
    switch (type) {
      case ANNOUNCE_CLIENT: {
        try {
          await this.announce();
        } catch (caughtError) {
          console.error(caughtError);
        }
      }
      case PIN_HASH: {
        if (!ipfsHash) {
          if (log.enabled) {
            // Only stringify when absolutely necessary
            log('PIN_HASH: no ipfsHash given: %O', message.data.toString());
          }
          return;
        }
        this.ipfsNode.pinHash(ipfsHash).catch(console.error);
        break;
      }
      case REPLICATE: {
        if (!address) {
          log('REPLICATE: no address given: %O', message.data);
          return;
        }
        try {
          const heads = await this.storeManager.loadStore(address);
          await this.publishHeads(address, heads);
        } catch (caughtError) {
          console.error(caughtError);
        }
        break;
      }
      default:
        break;
    }
  };

  private handleNewPeer = (): void => {
    this.announce().catch(console.error);
  };

  private async announce(): Promise<void> {
    return this.ipfsNode.publish({
      type: ANNOUNCE_PINNER,
      payload: {
        ipfsId: await this.getId(),
      },
    });
  }

  private publishHeads = async (
    address: string,
    count: number,
  ): Promise<void> => {
    return this.ipfsNode.publish<'HAVE_HEADS', ReplicationMessagePayload>({
      type: HAVE_HEADS,
      to: address,
      payload: {
        address,
        count,
        timestamp: Date.now(),
      },
    });
  };

  public async start(): Promise<void> {
    await this.ipfsNode.start();
    log('Pinner id: %s', this.ipfsNode.id);
    await this.storeManager.start();
    await this.announce(); // Announce on start because the room may have peers already
  }

  public async getId(): Promise<string> {
    return this.ipfsNode.getId();
  }

  public async close(): Promise<void> {
    log('Closing...');
    await this.storeManager.stop();
    await this.ipfsNode.stop();
    this.events.removeAllListeners();
  }
}

export default Pinion;
