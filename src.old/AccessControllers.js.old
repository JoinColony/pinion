class AccessControllerFactory {
  static async create(orbit, type, { controller: accessController }) {
    await accessController.load();
    return accessController.save();
  }

  static async resolve(
    orbitdb,
    accessControllerAddress,
    { controller: accessController },
  ) {
    return accessController;
  }
}

module.exports = AccessControllerFactory;
