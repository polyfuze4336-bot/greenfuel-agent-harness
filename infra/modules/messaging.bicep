// SCAFFOLD, NOT DEPLOYABLE. Ingestion messaging for one jurisdiction cell (Service Bus is a candidate, Event Hubs the alternative: D-031 volumes
// decide). Local authentication (shared access keys) is disabled, so access is by Microsoft Entra only. Duplicate detection supports
// idempotent sync (NFR-005). Public network access is disabled, and the documentation says Private Link for Service Bus is Premium only
// (docs/azure/REGIONAL-AVAILABILITY.md), so Premium is the only tier this module accepts. Geo-replication and geo-recovery are opt-in and
// are not configured: a copy in another region would need D-009 and D-011.
param location string
param namePrefix string

@allowed([
  'Premium'
])
param sku string
param capacity int
param zoneRedundant bool
param workspaceId string
param tags object

resource namespace 'Microsoft.ServiceBus/namespaces@2024-01-01' = {
  name: '${namePrefix}-sb-${uniqueString(resourceGroup().id)}'
  location: location
  tags: tags
  sku: {
    name: sku
    tier: sku
    capacity: capacity
  }
  properties: {
    disableLocalAuth: true
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Disabled'
    zoneRedundant: zoneRedundant
  }
}

resource ingestQueue 'Microsoft.ServiceBus/namespaces/queues@2024-01-01' = {
  parent: namespace
  name: 'delivery-events'
  properties: {
    requiresDuplicateDetection: true
    requiresSession: true
    deadLetteringOnMessageExpiration: true
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-workspace'
  scope: namespace
  properties: {
    workspaceId: workspaceId
    logs: [
      {
        categoryGroup: 'allLogs'
        enabled: true
      }
    ]
  }
}

output namespaceName string = namespace.name
output queueName string = ingestQueue.name
