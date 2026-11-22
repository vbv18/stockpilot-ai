export const MAX_SKUS_PER_SESSION = 15;

export const FORECAST_DEFAULTS = {
  horizon: 28,
  seasonLength: 7,
  nBootstrap: 500,
  blockSize: 7,
  minHistory: 56,
  originStep: 7,
  minResidualBlocks: 8,
};

export const SIMULATION_DEFAULTS = { nScenarios: 500, horizonDays: 90 };
export const SIMULATION_BOUNDS = {
  nScenariosMin: 100,
  nScenariosMax: 2000,
  horizonMin: 30,
  horizonMax: 180,
};

export const DEMO_ASSUMPTION_DEFAULTS = {
  ordering_cost: 200,
  holding_cost_annual: 1825,
  shortage_penalty: 50,
  lead_time_mean: 7,
  lead_time_std: 0,
  service_level: 0.95,
  unit_cost: 100,
};

export const RISK_THRESHOLDS = {
  ltdCvHigh: 0.5,
  policyDivergence: 0.2,
  wapeHigh: 0.5,
  coverageLow: 0.6,
  normalApproxMinMuL: 10,
  normalApproxMaxAbsSkew: 1.0,
};

export const SERVICE_NAME = "stockpilot-api";
