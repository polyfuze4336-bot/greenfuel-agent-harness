// SCAFFOLD, NOT DEPLOYABLE. Evidence blob store for one jurisdiction cell. Only locally and zone redundant SKUs are allowed: a geo-redundant
// SKU would copy evidence to another region, which HC-01 forbids unless D-009 and D-011 permit the flow. Shared keys and anonymous access are off.
param location string

@minLength(3)
param namePrefix string

@allowed([
  'Standard_LRS'
  'Standard_ZRS'
])
param sku string
param workspaceId string
param tags object

resource account 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: toLower('${take(replace(namePrefix, '-', ''), 9)}evid${take(uniqueString(resourceGroup().id), 11)}')
  location: location
  tags: tags
  sku: {
    name: sku
  }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    publicNetworkAccess: 'Disabled'
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'None'
    }
    immutableStorageWithVersioning: {
      enabled: true
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: account
  name: 'default'
  properties: {
    isVersioningEnabled: true
    deleteRetentionPolicy: {
      enabled: true
      allowPermanentDelete: false
    }
  }
}

resource evidenceContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'evidence'
  properties: {
    publicAccess: 'None'
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-workspace'
  scope: blobService
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
  scope: account
  properties: {
    level: 'CanNotDelete'
    notes: 'Evidence store: deletion is a P4 operation (docs/security/PERMISSION-MODEL.md).'
  }
}

output storageAccountName string = account.name
