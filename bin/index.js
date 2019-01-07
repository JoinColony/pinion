const Pinner = require('../src');

const [, , room = 'COLONY_PINNING_ROOM'] = process.argv;

const pinner = new Pinner(room);
pinner.init();
