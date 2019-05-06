import { randomBytes } from 'crypto';
import { promisify } from 'util';
import IPFS from 'ipfs';
import { serial as test } from 'ava';
import { EntryData } from 'ipfs-log';

import PeerMonitor = require('ipfs-pubsub-peer-monitor');
import OrbitDB = require('orbit-db');
// @ts-ignore We don't want to type that right now
import { create as createIPFS } from 'ipfsd-ctl';

import Pinion, { ClientAction } from '../Pinion';
import { ClientActions, PinnerActions } from '../actions';
const { LOAD_STORE, PIN_STORE, PIN_HASH } = ClientActions;
const { ACK, HAVE_HEADS, REPLICATED } = PinnerActions;
import AccessControllers from '../AccessControllers';
import PermissiveAccessController from '../PermissiveAccessController';

const { TEST_NODE_URL = '/ip4/127.0.0.1/tcp/4001/ipfs' } = process.env;

const noop = () => {};
const getId = () => randomBytes(16).toString('hex');
const publishMessage = async (
  ipfs: IPFS,
  room: string,
  action: ClientAction,
) => {
  ipfs.pubsub
    .publish(room, Buffer.from(JSON.stringify(action)))
    .catch(e => console.error(e));
};

let portCounter = 0;

const getIPFSNode = async (pinnerId: string) => {
  portCounter += 1;
  const client = createIPFS({ type: 'js' });
  const ipfsd = await promisify(client.spawn.bind(client))({
    config: {
      Addresses: {
        Swarm: [
          `/ip4/0.0.0.0/tcp/${4004 + portCounter}`,
          `/ip6/::/tcp/${4004 + portCounter}`,
        ],
      },
      // Bootstrap with our pinner node
      Bootstrap: [`${TEST_NODE_URL}/${pinnerId}`],
    },
    start: false,
  });
  await promisify(ipfsd.init.bind(ipfsd))({
    directory: `./ipfs-test-data/test-${getId()}`,
  });
  await promisify(ipfsd.start.bind(ipfsd))(['--enable-pubsub-experiment']);
  const { id: ipfsdId } = await ipfsd.api.id();
  const teardown = async () => {
    await promisify(ipfsd.cleanup.bind(ipfsd))();
    // TODO: if necessary we will add .stop here as well()
    return promisify(ipfsd.killProcess.bind(ipfsd))(4 * 1000);
  };
  return {
    ipfs: ipfsd.api,
    id: ipfsdId,
    teardown,
  };
};

const getOrbitNode = async (ipfs: IPFS) =>
  OrbitDB.createInstance(ipfs, {
    directory: `./orbitdb-test-data/test-${getId()}`,
    AccessControllers,
  });

const createKVStore = async (
  orbitNode: OrbitDB,
  storeIdentifier: string,
  data: Record<string, EntryData> = {},
) => {
  const store = await orbitNode.kvstore(storeIdentifier, {
    // @Note the access controller doesn't really matter, because of a bug in
    // orbit we still have to use the same one, as we share the OrbitDB module
    // in the tests
    accessController: { controller: new PermissiveAccessController() },
  });
  const keys = Object.keys(data);
  for (let i = 0; i < keys.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await store.set(keys[i], data[keys[i]]);
  }
  return store;
};

test('pinner joins the defined pubsub room', async t => {
  const room = 'JOIN_ROOM';
  const pinner = new Pinion(room);
  const pinnerId = await pinner.getId();
  const { ipfs, teardown } = await getIPFSNode(pinnerId);
  await ipfs.pubsub.subscribe(room, noop);
  const roomMonitor = new PeerMonitor(ipfs.pubsub, room);
  // We're initializing it to make ts happy
  let resolveRoomMonitor = noop;
  const roomMonitorPromise = new Promise(
    (resolve): void => {
      resolveRoomMonitor = resolve;
    },
  );
  roomMonitor.on('join', resolveRoomMonitor);
  await pinner.init();
  const peer = await roomMonitorPromise;
  t.is(peer, pinnerId);
  await ipfs.pubsub.unsubscribe(room, noop);
  roomMonitor.stop();
  await teardown();
  return pinner.close();
});
