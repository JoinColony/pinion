const { promisify } = require('util');

const test = require('ava');
const Pubsub = require('orbit-db-pubsub');
const OrbitDB = require('orbit-db');
const { create: createIPFS } = require('ipfsd-ctl');

const Pinner = require('..');
const { PIN_STORE } = require('../actions');

const ROOM = 'PINNER_TEST_ROOM';

const getOrbitNode = ipfs =>
  OrbitDB.createInstance(ipfs, {
    directory: `./orbitdb-test-data/test-${Math.round(Math.random() * 100000)}`,
  });

const getIPFSNode = async pinnerId => {
  const client = createIPFS({ type: 'js' });
  const ipfsd = await promisify(client.spawn.bind(client))({
    config: {
      Bootstrap: [`/ip4/127.0.0.1/tcp/4001/ipfs/${pinnerId}`],
    },
    defaultAddrs: true,
    start: false,
  });
  await promisify(ipfsd.start.bind(ipfsd))(['--enable-pubsub-experiment']);
  return ipfsd;
};

test('pinner joins the defined pubsub room', async t => {
  const pinner = await Pinner.createInstance({
    room: ROOM,
  });
  const { id } = await pinner._ipfs.id();
  console.info(`Pinner id: ${id}`);
  const ipfsd = await getIPFSNode(id);
  const ipfs = ipfsd.api;
  const { id: ipfsdId } = await ipfs.id();
  console.info(`IPFSD id: ${ipfsdId}`);
  const orbit = await getOrbitNode(ipfs);
  const store = await orbit.kvstore('kvstore1');
  await store.set({ foo: 'bar' });
  await store.set({ boo: 'baz' });
  const address = store.address.toString();
  const pubsub = new Pubsub(ipfs, ipfsdId);
  await pubsub.subscribe(
    ROOM,
    () => {},
    (topic, peer) => {
      console.info(`found new peer: ${peer}`);
      // On every new peer we tell everyone that we want to pin the store
      pubsub.publish(ROOM, { type: PIN_STORE, payload: { address } });
    },
  );
  const promise = new Promise(resolve => {
    pinner.on('pinned', msg => {
      resolve(msg);
    });
  });
  const result = await promise;
  t.is(result, address);
});
