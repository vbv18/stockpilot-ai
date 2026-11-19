export const STEPS = [
  "upload",
  "validation",
  "forecast",
  "assumptions",
  "optimization",
  "simulation",
];

export function currentStep(s) {
  switch (s) {
    case "created":
    case "uploading":
      return "upload";
    case "validating":
    case "validation_failed":
      return "validation";
    case "dataset_ready":
    case "forecasting":
    case "forecast_failed":
      return "forecast";
    case "forecast_ready":
      return "assumptions";
    case "assumptions_pending":
    case "optimizing":
    case "optimization_ready":
    case "optimization_failed":
      return "optimization";
    case "simulating":
    case "simulation_failed":
    case "completed":
      return "simulation";
    default:
      return "upload";
  }
}

export function maxReachableIndex(s) {
  switch (s) {
    case "created":
    case "uploading":
      return 0;
    case "validating":
    case "validation_failed":
      return 1;
    case "dataset_ready":
    case "forecasting":
    case "forecast_failed":
      return 2;
    case "forecast_ready":
      return 3;
    case "assumptions_pending":
    case "optimizing":
    case "optimization_failed":
      return 4;
    case "optimization_ready":
      return 5;
    case "simulating":
    case "simulation_failed":
    case "completed":
      return 5;
    default:
      return 0;
  }
}
