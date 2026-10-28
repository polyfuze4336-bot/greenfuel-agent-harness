// SCAFFOLD, NOT DEPLOYABLE. Secrets and certificates for one jurisdiction cell, NOT signing keys. The documentation says a standard or
// premium vault is replicated asynchronously to its paired region unless the region has none (docs/azure/REGIONAL-AVAILABILITY.md), which
// HC-01 and HC-03 may forbid for keys. Where signing keys live (a managed HSM is single-region by default, multi-region is opt-in) is D-013
// and is not scaffolded. Access is by Azure RBAC only; no access policies.
param location string
param namePrefix string
param workspaceId string
param tags object

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: take('${namePrefix}-kv-${uniqueString(resourceGroup().id)}', 24)
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'premium'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    enablePurgeProtection: true
    publicNetworkAccess: 'Disabled'
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'None'
    }
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-workspace'
  scope: vault
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
  scope: vault
  properties: {
    level: 'CanNotDelete'
    notes: 'Key custody: deletion is a P4 operation (docs/security/PERMISSION-MODEL.md).'
  }
}

output keyVaultName string = vault.name
