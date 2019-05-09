import OrbitDB from 'orbit-db';
import AccessControllers from 'orbit-db-access-controllers';

class AccessControllerFactory implements AccessControllers {
  public static async create(
    orbitDB: OrbitDB,
    type: string,
    { controller: accessController }: AccessControllers.AccessControllerObject,
  ): Promise<string> {
    await accessController.load();
    return accessController.save();
  }

  public static async resolve(
    orbitDB: OrbitDB,
    type: string,
    { controller: accessController }: AccessControllers.AccessControllerObject,
  ): Promise<AccessControllers.AccessController> {
    return accessController;
  }
}

export default AccessControllerFactory;
