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

const logError = debug('pinner:error');
const logDebug = debug('pinner:debug');
const { REPLICATE, PIN_HASH } = ClientActions;
const { HAVE_HEADS } = PinnerActions;

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

interface AckMessagePayload {
  acknowledgedAction: ClientActions;
  sender: string;
  address?: string;
  ipfsHash?: string;
  timestamp: number;
}

interface Options {
  ipfsDaemonURL?: string;
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
      ipfsDaemonURL = '/ip4/127.0.0.1/tcp/5001',
      maxOpenStores = 100,
      orbitDBDir = './orbitdb',
    }: Options = {},
  ) {
    assert(room && room.length, 'Pinning room is required for pinion to start');

    this.events = new EventEmitter();

    this.ipfsNode = new IPFSNode(this.events, ipfsDaemonURL, room);

    this.storeManager = new StoreManager(this.events, this.ipfsNode, {
      maxOpenStores,
      orbitDBDir,
    });

    this.events.on('pubsub:message', this.handleMessage);
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
      logError(`Could not parse pinner message: ${message.data}`);
    }

    if (!action) return;
    const { type, payload } = action;
    const { ipfsHash, address } = payload;
    switch (type) {
      case PIN_HASH: {
        if (!ipfsHash) {
          logError('PIN_HASH: no ipfsHash given');
          return;
        }
        this.ipfsNode.pinHash(ipfsHash).catch(logError);
        break;
      }
      case REPLICATE: {
        if (!address) {
          logError('REPLICATE: no address given');
          return;
        }
        try {
          const heads = await this.storeManager.loadStore(address);
          await this.publishHeads(address, heads);
        } catch (caughtError) {
          logError(caughtError);
        }
        break;
      }
      default:
        break;
    }
  };

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
    logDebug(`Pinner id: ${this.ipfsNode.id}`);
    await this.storeManager.start();
  }

  public async getId(): Promise<string> {
    return this.ipfsNode.getId();
  }

  public async close(): Promise<void> {
    logDebug('Closing...');
    await this.ipfsNode.stop();
    await this.storeManager.stop();
    this.events.removeAllListeners();
  }
}

export default Pinion;
