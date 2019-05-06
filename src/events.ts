/**
 * @file events shared event bus for all modules. This is a singleton.
 */

import { EventEmitter } from 'events';

const events = new EventEmitter();

export default events;
