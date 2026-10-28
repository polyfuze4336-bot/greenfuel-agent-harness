// SCAFFOLD, NOT DEPLOYABLE. Guardrails for one jurisdiction cell: an Azure Policy assignment that denies resources outside the allowed
// locations, and a cost budget with alert thresholds. The allowed locations and the budget amount are required decisions: no list and no
// figure is invented here. A location policy limits where resources are created; it is not proof of residency (HC-01).
param allowedLocations array
param budgetAmount int
param budgetContactEmails array
param budgetStartDate string
param namePrefix string

// Built-in policy definition "Allowed locations". Verify the ID with a read-only `az policy definition list` before use.
var allowedLocationsPolicyId = '/providers/Microsoft.Authorization/policyDefinitions/e56962a6-4747-49cd-b67b-bf8b01975c4c'

resource locationPolicy 'Microsoft.Authorization/policyAssignments@2024-05-01' = {
  name: '${namePrefix}-allowed-locations'
  properties: {
    displayName: 'Allowed locations for this jurisdiction cell'
    policyDefinitionId: allowedLocationsPolicyId
    enforcementMode: 'Default'
    parameters: {
      listOfAllowedLocations: {
        value: allowedLocations
      }
    }
  }
}

resource budget 'Microsoft.Consumption/budgets@2023-05-01' = {
  name: '${namePrefix}-budget'
  properties: {
    category: 'Cost'
    amount: budgetAmount
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: budgetStartDate
    }
    notifications: {
      actualAtEighty: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 80
        contactEmails: budgetContactEmails
        thresholdType: 'Actual'
      }
      forecastAtOneHundred: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 100
        contactEmails: budgetContactEmails
        thresholdType: 'Forecast'
      }
    }
  }
}
