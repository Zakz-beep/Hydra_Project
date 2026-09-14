declare module "plotly.js/lib/core" {
  import * as Plotly from "plotly.js";
  export = Plotly;
}
declare module "plotly.js/lib/surface" {
  const trace: import("plotly.js").PlotlyModule;
  export = trace;
}
declare module "plotly.js/lib/heatmap" {
  const trace: import("plotly.js").PlotlyModule;
  export = trace;
}
