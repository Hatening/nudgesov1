import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('.data/relaydesk.sqlite');
const filled = db.prepare("SELECT COUNT(*) c FROM knowledge WHERE structured_payload != '{}'").get().c;
const pending = db.prepare("SELECT COUNT(*) c FROM knowledge WHERE structured_payload = '{}' AND status = 'confirmed' AND license_status != 'hold'").get().c;
console.log(`filled=${filled} pending=${pending}`);
