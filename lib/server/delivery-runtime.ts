import "server-only";
import { getRepository } from "./database";
import { githubContextBindings } from "./github-context-provider";
import { DeliveryEvidenceStore } from "./delivery-evidence";
export function deliveryOptions() { const bindings = githubContextBindings(process.env); const store = new DeliveryEvidenceStore(getRepository(), bindings); return { bindings, verifyEvidence: (input: Parameters<DeliveryEvidenceStore["verified"]>[0]) => store.verified(input) }; }
