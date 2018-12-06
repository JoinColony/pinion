const ipfsClient = require('ipfs-http-client');

const ipfs = ipfsClient('/ip4/127.0.0.1/tcp/5001');

console.info(ipfs);
