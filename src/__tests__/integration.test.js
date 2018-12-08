const { promisify } = require('util');

const test = require('ava');
const Pubsub = require('orbit-db-pubsub');
const OrbitDB = require('orbit-db');
const { create: createIPFS } = require('ipfsd-ctl');

const Pinner = require('..');
const { PIN_STORE } = require('../actions');

let portCounter = 0;

const getIPFSNode = async pinnerId => {
  portCounter += 1;
  const client = createIPFS({ type: 'js' });
  const ipfsd = await promisify(client.spawn.bind(client))({
    config: {
      Addresses: {
        Swarm: [
          `/ip4/0.0.0.0/tcp/${4002 + portCounter}`,
          `/ip6/::/tcp/${4002 + portCounter}`,
        ],
      },
      Bootstrap: [`/ip4/127.0.0.1/tcp/4001/ipfs/${pinnerId}`],
    },
    start: false,
  });
  await promisify(ipfsd.start.bind(ipfsd))(['--enable-pubsub-experiment']);
  const { id: ipfsdId } = await ipfsd.api.id();
  return {
    ipfs: ipfsd.api,
    id: ipfsdId,
  };
};

const getOrbitNode = async ipfs =>
  OrbitDB.createInstance(ipfs, {
    directory: `./orbitdb-test-data/test-${Math.round(Math.random() * 100000)}`,
  });

const createKVStore = async (orbitNode, data = {}) => {
  const store = await orbitNode.kvstore('kvstore1');
  const keys = Object.keys(data);
  for (let i = 0; i < keys.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await store.set(keys[i], data[keys[i]]);
  }
  return store.address.toString();
};

test('pinner joins the defined pubsub room', async t => {
  const room = 'JOIN_ROOM';
  const pinner = await Pinner.createInstance({ room });
  const { id: pinnerId } = await pinner._ipfs.id();
  const { ipfs, id: ipfsdId } = await getIPFSNode(pinnerId);
  const pubsub = new Pubsub(ipfs, ipfsdId);
  return new Promise(async resolve => {
    await pubsub.subscribe(
      room,
      () => {},
      async (topic, peer) => {
        t.is(peer, pinnerId);
        await pinner.close();
        resolve();
      },
    );
  });
});

test('pinner pins stuff', async t => {
  const room = 'PIN_ROOM';
  const pinner = await Pinner.createInstance({ room });
  const { id: pinnerId } = await pinner._ipfs.id();
  const { ipfs, id: ipfsdId } = await getIPFSNode(pinnerId);
  const pubsub = new Pubsub(ipfs, ipfsdId);
  const orbit = await getOrbitNode(ipfs);
  const storeAddress = await createKVStore(orbit, { foo: 'bar', biz: 'baz' });
  await pubsub.subscribe(
    room,
    () => {},
    async () => {
      // On every new peer we tell everyone that we want to pin the store
      pubsub.publish(room, {
        type: PIN_STORE,
        payload: { address: storeAddress },
      });
    },
  );
  const pinnedStoreAddress = await new Promise(resolve => {
    pinner.on('pinned', msg => {
      resolve(msg);
    });
  });
  t.is(pinnedStoreAddress, storeAddress);
});
