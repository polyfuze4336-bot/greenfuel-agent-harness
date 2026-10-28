// SCAFFOLD, NOT DEPLOYABLE. One jurisdiction cell (docs/azure/AZURE-REFERENCE-ARCHITECTURE.md). Phase 0: nothing here has been deployed,
// what-if run or approved, and no service in it is a decision (ADR 0014). Unresolved decisions are required parameters with no default,
// so a deployment cannot be reached by accident. deploymentApproved accepts only true, and the committed parameter files carry
// REQUIRES-APPROVAL placeholders, so the files cannot be deployed as they are. Deployment is a human-run action (HC-11).
targetScope = 'resourceGroup'

@allowed([
  'dev'
  'test'
  'prod'
])
param environment string

@description('Jurisdiction cell code. Set by D-003; never inferred from a region name.')
@minLength(2)
@maxLength(8)
param jurisdictionCode string

@description('The region of this cell. A region is not proof of residency (HC-01); the sovereignty deployment matrix must record the evidence first.')
param location string

@description('Accepts only true. Setting it requires a recorded approval, which the human running the deployment supplies.')
@allowed([
  true
])
param deploymentApproved bool

@description('Reference to the recorded approval record (docs/approvals).')
@minLength(8)
param approvalReference string

@description('Tags. Never place a customer name, vessel name or any sensitive value in a tag or a resource name.')
param tags object

param logRetentionInDays int
param logIngestionNetworkAccess string
param storageSku string
param serviceBusSku string
param serviceBusCapacity int
param serviceBusZoneRedundant bool
param postgresSkuName string
param postgresSkuTier string
param postgresStorageSizeGB int
param postgresHighAvailabilityMode string
param postgresVersion string
param containerAppsSubnetId string
param allowedLocations array
param budgetAmount int
param budgetContactEmails array
param budgetStartDate string

var namePrefix = 'gf-${environment}-${jurisdictionCode}'
var allTags = union(tags, {
  environment: environment
  jurisdiction: jurisdictionCode
  approval: approvalReference
  deploymentApproved: string(deploymentApproved)
})

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    location: location
    namePrefix: namePrefix
    retentionInDays: logRetentionInDays
    ingestionNetworkAccess: logIngestionNetworkAccess
    tags: allTags
  }
}

module evidenceStorage 'modules/evidence-storage.bicep' = {
  name: 'evidenceStorage'
  params: {
    location: location
    namePrefix: namePrefix
    sku: storageSku
    workspaceId: monitoring.outputs.workspaceId
    tags: allTags
  }
}

module keyVault 'modules/key-vault.bicep' = {
  name: 'keyVault'
  params: {
    location: location
    namePrefix: namePrefix
    workspaceId: monitoring.outputs.workspaceId
    tags: allTags
  }
}

module messaging 'modules/messaging.bicep' = {
  name: 'messaging'
  params: {
    location: location
    namePrefix: namePrefix
    sku: serviceBusSku
    capacity: serviceBusCapacity
    zoneRedundant: serviceBusZoneRedundant
    workspaceId: monitoring.outputs.workspaceId
    tags: allTags
  }
}

module database 'modules/postgres.bicep' = {
  name: 'database'
  params: {
    location: location
    namePrefix: namePrefix
    skuName: postgresSkuName
    skuTier: postgresSkuTier
    storageSizeGB: postgresStorageSizeGB
    highAvailabilityMode: postgresHighAvailabilityMode
    version: postgresVersion
    workspaceId: monitoring.outputs.workspaceId
    tags: allTags
  }
}

module appsEnvironment 'modules/container-apps-environment.bicep' = {
  name: 'appsEnvironment'
  params: {
    location: location
    namePrefix: namePrefix
    infrastructureSubnetId: containerAppsSubnetId
    workspaceId: monitoring.outputs.workspaceId
    tags: allTags
  }
}

module identities 'modules/identity-rbac.bicep' = {
  name: 'identities'
  params: {
    location: location
    namePrefix: namePrefix
    storageAccountName: evidenceStorage.outputs.storageAccountName
    keyVaultName: keyVault.outputs.keyVaultName
    serviceBusNamespaceName: messaging.outputs.namespaceName
    tags: allTags
  }
}

module guardrails 'modules/guardrails.bicep' = {
  name: 'guardrails'
  params: {
    allowedLocations: allowedLocations
    budgetAmount: budgetAmount
    budgetContactEmails: budgetContactEmails
    budgetStartDate: budgetStartDate
    namePrefix: namePrefix
  }
}

output workspaceId string = monitoring.outputs.workspaceId
output storageAccountName string = evidenceStorage.outputs.storageAccountName
