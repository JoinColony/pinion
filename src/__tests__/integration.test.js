const { promisify } = require('util');

const test = require('ava');
const Pubsub = require('orbit-db-pubsub');
const { create: createIPFS } = require('ipfsd-ctl');

const Pinner = require('..');

const ROOM = 'PINNER_TEST_ROOM';

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
  const bs = await promisify(ipfsd.getConfig.bind(ipfsd))('Bootstrap');
  console.info(bs);
  const ipfs = ipfsd.api;
  const { id: ipfsdId } = await ipfs.id();
  console.info(`IPFSD id: ${ipfsdId}`);
  const pubsub = new Pubsub(ipfs, ipfsdId);
  pinner.on('newpeer', () => {
    pubsub.publish(ROOM, { type: 'PIN_STORE' });
  });
  await pubsub.subscribe(ROOM, () => {}, () => {});
  const result = await new Promise(resolve => {
    pinner.on('message', msg => {
      resolve(msg);
    });
  });
  t.deepEqual(result, { type: 'PIN_STORE' });
});
