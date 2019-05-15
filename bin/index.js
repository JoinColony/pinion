#!/usr/bin/env node
const { default: Pinner } = require('../lib');
const { config } = require('dotenv');

if (process.env.NODE_ENV !== 'production') config();

const {
  PINION_ROOM: room,
  PINION_IPFS_DAEMON_URL: ipfsDaemonURL,
  PINION_MAX_OPEN_STORES: maxOpenStores,
  PINION_ORBIT_DB_DIR: orbitDBDir,
} = process.env;

if (!room) {
  throw new Error('PINION_ROOM has to be specified.');
}

const pinner = new Pinner(room, {
  ipfsDaemonURL,
  maxOpenStores,
  orbitDBDir,
});

pinner.start().catch(caughtError => {
  console.error(caughtError);
  console.error('Pinion crashed. Exiting...');
  process.exit(1);
});
