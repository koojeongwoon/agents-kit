// The desired ownership record is shared by preview and both write engines.
// Transaction anchors are attached only when constructing a new ledger state.
export function nextDeploymentManagedRecord(operation) {
  if (['shared', 'resource-removal', 'native-source', 'physical-resource'].includes(operation.strategy)) return operation.nextManaged || null;
  if (operation.strategy === 'merge') return {clientId: operation.clientId, strategy: 'merge', ownership: operation.ownership, hash: operation.expectedHash, owners: operation.owners};
  if (operation.strategy === 'link') return {clientId: operation.clientId, assetId: operation.assetId, strategy: 'link', ownership: 'link', hash: operation.expectedHash, linkSource: operation.linkSource};
  return {clientId: operation.clientId, assetId: operation.assetId, ...(operation.resource ? {resource: operation.resource} : {}), strategy: operation.strategy, ownership: operation.ownership, hash: operation.expectedHash};
}

export const stampDeploymentManagedRecords = (records, transactionId) => Object.fromEntries(Object.entries(records).map(([target, record]) => [target, {...structuredClone(record), transactionId}]));
