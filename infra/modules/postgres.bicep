// SCAFFOLD, NOT DEPLOYABLE. Ledger and metadata database for one jurisdiction cell (PostgreSQL flexible server is a candidate). Entra
// authentication only; no password. Geo-redundant backup is off, because a backup copy in another region would breach HC-01 unless D-009
// and D-011 permit the flow. Sizing, tier, version and high availability are required decisions (D-031).
param location string
param namePrefix string
param skuName string

@allowed([
  'Burstable'
  'GeneralPurpose'
  'MemoryOptimized'
])
param skuTier string
param storageSizeGB int

@allowed([
  'Disabled'
  'SameZone'
  'ZoneRedundant'
])
param highAvailabilityMode string
param version string
param workspaceId string
param tags object

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: '${namePrefix}-pg-${uniqueString(resourceGroup().id)}'
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: skuTier
  }
  properties: {
    version: version
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
      tenantId: subscription().tenantId
    }
    network: {
      publicNetworkAccess: 'Disabled'
    }
    storage: {
      storageSizeGB: storageSizeGB
    }
    backup: {
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: highAvailabilityMode
    }
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-workspace'
  scope: server
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

resource noDelete 'Microsoft.Authorization/locks@2020-05-01' = {
  name: 'no-delete'
  scope: server
  properties: {
    level: 'CanNotDelete'
    notes: 'Ledger database: deletion is a P4 operation (docs/security/PERMISSION-MODEL.md).'
  }
}

output serverName string = server.name
