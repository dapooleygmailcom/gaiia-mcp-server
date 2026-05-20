import { executeGraphQL, logger } from '../core/index.js';

const LIST_BPMN_TEMPLATES_QUERY = `
  query ListBpmnTemplates {
    listBpmnTemplates {
      processType
      name
      description
      updatedAt
      createdAt
    }
  }
`;

const TRIGGER_PROCESS_INSTANCE_MUTATION = `
  mutation TriggerProcessInstance($processType: String!, $triggerPayloadJson: String!) {
    triggerProcessInstance(processType: $processType, triggerPayloadJson: $triggerPayloadJson) {
      userEmail
      processId
      processType
      status
      triggeredAt
      completedAt
    }
  }
`;

/**
 * Lists all registered BPMN process templates/blueprints in the GAIIA registry
 * for the authenticated tenant.
 */
export async function handleListBpmnTemplates(): Promise<any[]> {
  logger.info("Fetching registered BPMN blueprints...");
  const data = await executeGraphQL(LIST_BPMN_TEMPLATES_QUERY);
  return data.listBpmnTemplates || [];
}

/**
 * Triggers/starts an instance of a registered BPMN process blueprint in the cloud.
 * 
 * @param processType The unique processType/slug of the BPMN template (e.g. driver-roster-change)
 * @param triggerPayload Custom context payload to feed into the initial process state
 */
export async function handleTriggerProcessInstance(processType: string, triggerPayload?: any): Promise<any> {
  if (!processType) {
    throw new Error("processType/slug is required to trigger a process run.");
  }

  const payload = triggerPayload || {};
  const triggerPayloadJson = JSON.stringify(payload);

  logger.info(`Triggering process instance of type: ${processType}`);
  const data = await executeGraphQL(TRIGGER_PROCESS_INSTANCE_MUTATION, {
    processType,
    triggerPayloadJson
  });

  return data.triggerProcessInstance;
}
