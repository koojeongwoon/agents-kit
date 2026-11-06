import path from 'node:path';
import {catalogWithObservations} from './resource-catalog-service.js';

export function attachNativeMcpInventory(catalog, parsed, {clientId, surface, homeDir, definitions}) {
  const resolve = value => value.startsWith('~/') ? path.join(homeDir,value.slice(2)) : path.resolve(value);
  const registrations = parsed.records.map(record => ({...record, kind: 'mcpServers', manageable: false,
    sourceCandidates: catalog.observations.filter(entry => entry.kind === 'mcpServers' && entry.clientId === clientId && entry.surface === surface && entry.id === record.name).map(entry=>entry.catalogId)}));
  const observations = catalog.observations.map(entry => {
    if (entry.clientId !== clientId || entry.surface !== surface || entry.kind !== 'mcpServers' || entry.entryType === 'symlink' || entry.managementMode === 'external') return entry;
    const file = resolve(entry.sourcePath), registration = registrations.find(item=>item.name===entry.id);
    if (parsed.ignored.includes(file)) return {...entry,nativeEvidence:{state:'ignored'},activation:'unknown'};
    if (!registration) return {...entry,nativeEvidence:{state:'not-listed'},activation:'unknown'};
    if (registration.composition === 'unverified') return {...entry,nativeEvidence:{state:'unverified'},activation:'unknown'};
    const fields = registration.origins.filter(source=>source.path===file).map(source=>source.field);
    if (!fields.length) return {...entry,nativeEvidence:{state:'shadowed'},activation:'unknown'};
    if (registration.composition === 'composed') return {...entry,nativeEvidence:{state:'contributing',sourceFields:fields},activation:'unknown'};
    return {...entry,nativeEvidence:{state:'listed',enabled:registration.enabled,sourceFields:fields},activation:registration.enabled?'enabled':'disabled'};
  });
  const updated = catalogWithObservations(catalog,observations,{homeDir,definitions});
  return {...updated,effective:updated.effective.map(group=> {
    const registration = group.clientId===clientId && group.surface===surface && group.kind==='mcpServers' ? registrations.find(item=>item.name===group.name) : undefined;
    return registration ? {...group,nativeConfiguration:registration} : group;
  }),registrations};
}
