// SCAFFOLD, NOT DEPLOYABLE. Workload identities and their least-privilege data-plane roles. One user-assigned identity per role of the
// platform; each gets only the narrow built-in roles it needs, at the narrowest scope. No Owner, Contributor or User Access Administrator
// role is granted here, and no identity here can deploy anything. Role definition IDs are from memory of the built-in roles and must be
// checked with a read-only `az role definition list` before use (docs/azure/DEPLOYMENT-STRATEGY.md); validate-azure pins the allowed set.
param location string
param namePrefix string
param storageAccountName string
param keyVaultName string
param serviceBusNamespaceName string
param tags object

var storageBlobDataContributor = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var storageBlobDataReader = '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'
var keyVaultSecretsUser = '4633458b-17de-408a-b874-0445c86b69e6'
var serviceBusDataSender = '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39'
var serviceBusDataReceiver = '4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0'

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource bus 'Microsoft.ServiceBus/namespaces@2024-01-01' existing = {
  name: serviceBusNamespaceName
}

resource ingestion 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${namePrefix}-id-ingestion'
  location: location
  tags: tags
}

resource calculation 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${namePrefix}-id-calculation'
  location: location
  tags: tags
}

resource ingestionReceives 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(bus.id, ingestion.id, serviceBusDataReceiver)
  scope: bus
  properties: {
    principalId: ingestion.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', serviceBusDataReceiver)
  }
}

resource ingestionSends 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(bus.id, ingestion.id, serviceBusDataSender)
  scope: bus
  properties: {
    principalId: ingestion.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', serviceBusDataSender)
  }
}

resource ingestionWritesEvidence 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, ingestion.id, storageBlobDataContributor)
  scope: storage
  properties: {
    principalId: ingestion.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributor)
  }
}

resource calculationReadsEvidence 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, calculation.id, storageBlobDataReader)
  scope: storage
  properties: {
    principalId: calculation.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataReader)
  }
}

resource calculationReadsSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, calculation.id, keyVaultSecretsUser)
  scope: vault
  properties: {
    principalId: calculation.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUser)
  }
}

output ingestionIdentityId string = ingestion.id
output calculationIdentityId string = calculation.id
