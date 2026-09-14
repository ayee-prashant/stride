import "server-only";
import { getRepository } from "./database";
import { githubContextBindings } from "./github-context-provider";
import { DeliveryEvidenceStore } from "./delivery-evidence";
import { deliverySessionCheck, deliveryDatabaseClock } from "./delivery-session";
export function deliveryOptions() { const bindings = githubContextBindings(process.env); const store = new DeliveryEvidenceStore(getRepository(), bindings); return { bindings, databaseClock: deliveryDatabaseClock, sessionActive: deliverySessionCheck(getRepository()), verifyEvidence: (input: Parameters<DeliveryEvidenceStore["verified"]>[0]) => store.verified(input) }; }
