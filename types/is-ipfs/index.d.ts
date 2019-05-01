declare module 'is-ipfs' {
  // TODO: this is just what we need. Would be nice to type the whole module
  // sometime.
  namespace isIPFS {
    function cid(hash: string): boolean;
  }

  export = isIPFS;
}
