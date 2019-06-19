#!/usr/bin/env node
const { default: Pinner } = require('../lib');
const { config } = require('dotenv');

if (process.env.NODE_ENV !== 'production') config();

const {
  PINION_ROOM: room,
  PINION_IPFS_PRIVATE_KEY: ipfsPrivateKey,
  PINION_IPFS_REPO: ipfsRepo,
  PINION_MAX_OPEN_STORES: maxOpenStores,
  PINION_ORBIT_DB_DIR: orbitDBDir,
} = process.env;

if (!room) {
  throw new Error('PINION_ROOM has to be specified.');
}

const pinner = new Pinner(room, {
  ipfsPrivateKey,
  ipfsRepo,
  maxOpenStores,
  orbitDBDir,
});

pinner
  .start()
  .then(() => {
    console.info(`Pinner started in room ${room} with daemon ${ipfsDaemonURL}`);
  })
  .catch(caughtError => {
    console.error(caughtError);
    console.error('Pinion crashed. Exiting...');
    process.exit(1);
  });
