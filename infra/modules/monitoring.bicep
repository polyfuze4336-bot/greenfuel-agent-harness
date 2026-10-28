// SCAFFOLD, NOT DEPLOYABLE. Observability for one jurisdiction cell. The workspace lives in the cell's region so logs stay with the data
// they describe (DC-14); whether a region meets D-009 is not assumed. The documentation says Application Insights ingestion endpoints are
// global whatever the workspace region, so no sensitive content may be emitted to it (docs/azure/OPERATIONS-AND-DR.md). The network access
// for ingestion is a required decision.
param location string
param namePrefix string
param retentionInDays int

@allowed([
  'Enabled'
  'Disabled'
])
param ingestionNetworkAccess string
param tags object

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-law'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: retentionInDays
    publicNetworkAccessForIngestion: ingestionNetworkAccess
    publicNetworkAccessForQuery: 'Disabled'
    features: {
      disableLocalAuth: true
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${namePrefix}-appi'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    DisableLocalAuth: true
    publicNetworkAccessForIngestion: ingestionNetworkAccess
    publicNetworkAccessForQuery: 'Disabled'
  }
}

output workspaceId string = workspace.id
output appInsightsId string = appInsights.id
