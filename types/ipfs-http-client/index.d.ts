declare module 'ipfs-http-client' {
  import IPFS from 'ipfs';

  function ipfsClient(daemonURL: string): IPFS;
  export = ipfsClient;
}
