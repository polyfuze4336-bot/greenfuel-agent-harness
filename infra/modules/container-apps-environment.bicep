// SCAFFOLD, NOT DEPLOYABLE. Runtime for the business agents and the deterministic services (Container Apps is a candidate, App Service the
// alternative). Internal only: no public endpoint. Logs go to Azure Monitor, not through a workspace shared key, so no key is handled here.
// No application is defined: Phase 0 permits none (HC-11).
param location string
param namePrefix string
param infrastructureSubnetId string
param workspaceId string
param tags object

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${namePrefix}-cae'
  location: location
  tags: tags
  properties: {
    vnetConfiguration: {
      internal: true
      infrastructureSubnetId: infrastructureSubnetId
    }
    appLogsConfiguration: {
      destination: 'azure-monitor'
    }
    zoneRedundant: false
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-workspace'
  scope: environment
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

output environmentId string = environment.id
